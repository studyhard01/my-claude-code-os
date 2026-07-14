/**
 * push 게이트 평가 스크립트 (rubric 원본 = docs/eval-rubric.md)
 *
 * 사용: npm run eval
 *  - 전 항목 통과(100점) → exit 0 → /ship 이 push 를 진행한다
 *  - 하나라도 실패      → exit 1 → push 금지
 *
 * 평가 서버는 3100 포트에 따로 띄운다(사용자의 3000 dev 서버와 충돌 방지).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const PORT = 3100;
let base = `http://localhost:${PORT}`;

interface Item {
  id: string;
  name: string;
  weight: number;
  pass: boolean | null; // null = 미실행(선행 실패로 건너뜀)
  note: string;
}

const items: Item[] = [
  { id: "A1", name: "타입 검사 (typecheck)", weight: 15, pass: null, note: "" },
  { id: "A2", name: "단위 테스트 (vitest)", weight: 15, pass: null, note: "" },
  { id: "B1", name: "서비스 기동", weight: 10, pass: null, note: "" },
  { id: "C1", name: "피드 목록 계약", weight: 8, pass: null, note: "" },
  { id: "C2", name: "정렬 (sort=recent)", weight: 5, pass: null, note: "" },
  { id: "C3", name: "필터 (role)", weight: 5, pass: null, note: "" },
  { id: "C4", name: "상세 + 404 에러 계약", weight: 7, pass: null, note: "" },
  { id: "C5", name: "북마크 왕복 (CRUD)", weight: 10, pass: null, note: "" },
  { id: "C6", name: "사용자 조건 왕복", weight: 5, pass: null, note: "" },
  { id: "D1", name: "응답 시간 — 목록", weight: 12, pass: null, note: "" },
  { id: "D2", name: "응답 시간 — 상세", weight: 8, pass: null, note: "" },
];

function set(id: string, pass: boolean, note = "") {
  const it = items.find((i) => i.id === id)!;
  it.pass = pass;
  it.note = note;
}

function runNpm(args: string[]): boolean {
  const r = spawnSync(["npm", ...args].join(" "), { shell: true, encoding: "utf8", timeout: 180_000 });
  if (r.status !== 0) {
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    console.error(out.split("\n").slice(-25).join("\n"));
  }
  return r.status === 0;
}

async function http(path: string, init?: RequestInit): Promise<{ status: number; ms: number; body: any }> {
  const t0 = performance.now();
  const res = await fetch(`${base}${path}`, init);
  const ms = performance.now() - t0;
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* 204 등 본문 없음 */
  }
  return { status: res.status, ms, body };
}

async function waitForServer(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/jobs`);
      if (res.status < 500) return true;
    } catch {
      /* 아직 안 뜸 */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

function killTree(child: ChildProcess) {
  if (child.pid == null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: true });
  } else {
    child.kill("SIGTERM");
  }
}

async function main() {
  // ---- A. 정적 검증 ----
  console.log("A1. typecheck ...");
  set("A1", runNpm(["run", "typecheck"]));
  console.log("A2. unit tests ...");
  set("A2", runNpm(["test"]));

  // ---- B. 서비스 기동 ----
  console.log(`B1. dev 서버 기동 (port ${PORT}) ...`);
  const server = spawn(`npx next dev -p ${PORT}`, {
    shell: true,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // next 가 포트 충돌로 다른 포트를 잡으면 로그에서 실제 포트를 읽는다
  server.stdout?.on("data", (d: Buffer) => {
    const m = d.toString().match(/localhost:(\d+)/);
    if (m && Number(m[1]) !== PORT) base = `http://localhost:${m[1]}`;
  });

  try {
    const up = await waitForServer(90_000);
    set("B1", up, up ? base : "90초 내 미기동");
    if (!up) return; // C·D 는 전부 미실행(FAIL) 처리

    // 워밍업 — dev 모드는 라우트별 첫 요청에 컴파일 비용이 섞인다
    const first = await http("/api/jobs");
    await http("/api/bookmarks");
    await http("/api/me/preferences");

    // ---- C1. 피드 목록 계약 ----
    const list = first.status === 200 ? first : await http("/api/jobs");
    const b = list.body;
    const c1 =
      list.status === 200 &&
      Array.isArray(b?.items) &&
      typeof b?.totalCount === "number" &&
      typeof b?.partialHiddenCount === "number" &&
      b !== null &&
      "nextCursor" in b;
    set("C1", c1, c1 ? `items ${b.items.length} · total ${b.totalCount}` : `status ${list.status}`);
    const jobs: any[] = c1 ? b.items : [];

    // ---- C2. sort=recent → postedAt 내림차순 ----
    const recent = await http("/api/jobs?sort=recent");
    let sorted = recent.status === 200 && Array.isArray(recent.body?.items);
    if (sorted) {
      const dates = recent.body.items
        .map((j: any) => j.postedAt)
        .filter((d: string | null) => d !== null);
      for (let i = 1; i < dates.length; i++) {
        if (dates[i - 1] < dates[i]) sorted = false;
      }
    }
    set("C2", sorted);

    // ---- C3. role 필터 — 목록에 실존하는 role 로 검사 (0건 통과 = 빈 배열의 함정 방지) ----
    const knownRole = jobs.map((j) => j.jobRole).find((r) => r !== null);
    if (!knownRole) {
      set("C3", false, "role 있는 공고가 없어 검증 불가");
    } else {
      const filtered = await http(`/api/jobs?role=${encodeURIComponent(knownRole)}`);
      const c3 =
        filtered.status === 200 &&
        Array.isArray(filtered.body?.items) &&
        filtered.body.items.length >= 1 &&
        filtered.body.items.every((j: any) => j.jobRole === knownRole);
      set("C3", c3, `${knownRole} ${filtered.body?.items?.length ?? "?"}건`);
    }

    // ---- C4. 상세 + 404 에러 계약 ----
    if (jobs.length === 0) {
      set("C4", false, "목록이 비어 상세 검증 불가");
    } else {
      const detail = await http(`/api/jobs/${jobs[0].id}`);
      const missing = await http(`/api/jobs/no-such-id-000`);
      const c4 =
        detail.status === 200 &&
        detail.body?.id === jobs[0].id &&
        missing.status === 404 &&
        typeof missing.body?.error?.code === "string";
      set("C4", c4, c4 ? "" : `상세 ${detail.status} / 404케이스 ${missing.status}`);
    }

    // ---- C5. 북마크 왕복 (만들고 지우므로 반복 실행 안전) ----
    const target = jobs.find((j) => j.bookmark === null);
    if (!target) {
      set("C5", false, "미북마크 공고가 없어 검증 불가");
    } else {
      const created = await http("/api/bookmarks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: target.id }),
      });
      const bid = created.body?.bookmarkId;
      const inList = async () => {
        const r = await http("/api/bookmarks");
        return Array.isArray(r.body?.items) && r.body.items.some((j: any) => j.id === target.id);
      };
      const afterCreate = created.status < 300 && typeof bid === "string" && (await inList());
      const patched = afterCreate
        ? await http(`/api/bookmarks/${bid}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status: "APPLIED" }),
          })
        : null;
      const patchOk = patched?.status === 200 && patched.body?.status === "APPLIED";
      const deleted = bid ? await http(`/api/bookmarks/${bid}`, { method: "DELETE" }) : null;
      const deleteOk = (deleted?.status ?? 500) < 300 && !(await inList());
      set("C5", afterCreate && !!patchOk && deleteOk, `생성 ${created.status} → PATCH → DELETE`);
    }

    // ---- C6. 사용자 조건 왕복 ----
    const pref = await http("/api/me/preferences");
    let c6 = pref.status === 200 && Array.isArray(pref.body?.roles);
    if (c6) {
      const put = await http("/api/me/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pref.body),
      });
      c6 = put.status === 200;
    }
    set("C6", c6);

    // ---- D. 응답 시간 (워밍업 후 5회) ----
    const listTimes: number[] = [];
    for (let i = 0; i < 5; i++) listTimes.push((await http("/api/jobs")).ms);
    const listAvg = listTimes.reduce((a, x) => a + x, 0) / listTimes.length;
    const listMax = Math.max(...listTimes);
    set("D1", listAvg < 500 && listMax < 1500, `평균 ${listAvg.toFixed(0)}ms · 최대 ${listMax.toFixed(0)}ms`);

    if (jobs.length > 0) {
      const detailTimes: number[] = [];
      for (let i = 0; i < 5; i++) detailTimes.push((await http(`/api/jobs/${jobs[0].id}`)).ms);
      const detailAvg = detailTimes.reduce((a, x) => a + x, 0) / detailTimes.length;
      set("D2", detailAvg < 500, `평균 ${detailAvg.toFixed(0)}ms`);
    } else {
      set("D2", false, "목록이 비어 측정 불가");
    }
  } finally {
    killTree(server);
  }
}

main()
  .catch((e) => console.error("평가 실행 오류:", e))
  .finally(() => {
    // ---- 리포트 ----
    let score = 0;
    console.log("\n================ push 게이트 평가 결과 ================");
    for (const it of items) {
      const ok = it.pass === true;
      if (ok) score += it.weight;
      const mark = ok ? "PASS" : it.pass === false ? "FAIL" : "SKIP";
      console.log(
        `${mark.padEnd(5)} ${it.id.padEnd(3)} ${it.name.padEnd(22)} ${String(ok ? it.weight : 0).padStart(3)}/${String(it.weight).padStart(3)}  ${it.note}`
      );
    }
    console.log("-------------------------------------------------------");
    const pass = score === 100;
    console.log(`총점 ${score}/100 → PUSH GATE: ${pass ? "PASS (push 허용)" : "FAIL (push 금지)"}`);
    console.log("=======================================================");
    process.exit(pass ? 0 : 1);
  });
