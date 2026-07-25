"use client";

// ============================================================================
// 회사 리서치 화면 (OS.md 5.2 · 6장 · 12.11 — M2b 조각 1)
// ----------------------------------------------------------------------------
// 진입: ① 공고 상세 "이 회사 리서치 보기" ② 온보딩 구독 회사 태그.
// 구성:
//   ① 회사 메타(이름 + 구독 토글 + 채용 페이지 링크)
//   ② 외부 데이터 슬롯(공시 요약 · 인재상/핵심가치) — 조각 1 은 researchStatus="PENDING"
//      → "준비 중 · 직접 확인" 폴백(빈 화면 금지). 조각 2·3 이 이 자리를 실데이터로 채운다.
//   ③ 리서치 노트 편집기 — 불러오기 → 편집 → 저장(PUT) → 삭제(빈 내용/삭제 버튼)
// 상태: 로딩 스켈레톤 / 404(없는 회사) / 에러(재시도) / 노트 없는 회사의 빈 편집기.
//   노트 저장 실패는 비차단(입력 내용 보존 + 인라인 경고).
// ============================================================================

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Company, ResearchStatus } from "@/types/contract";
import {
  fetchCompanyResearch,
  upsertResearchNote,
  deleteResearchNote,
  ApiRequestError,
} from "@/lib/api";
import { ErrorState } from "@/components/states";
import SubscribeButton from "@/components/SubscribeButton";

export default function CompanyResearchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [company, setCompany] = useState<Company | null>(null);
  const [researchStatus, setResearchStatus] =
    useState<ResearchStatus>("PENDING");
  const [initialNote, setInitialNote] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 편집기를 노트 로드 결과로 다시 초기화하기 위한 key */
  const [noteKey, setNoteKey] = useState(0);

  const load = () => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    setNotFound(false);
    fetchCompanyResearch(id, ctrl.signal)
      .then((res) => {
        setCompany(res.company);
        setResearchStatus(res.researchStatus);
        setInitialNote(res.note?.content ?? "");
        setNoteKey((k) => k + 1);
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        if (e instanceof ApiRequestError && e.status === 404) setNotFound(true);
        else
          setError(
            e instanceof ApiRequestError
              ? e.message
              : "회사 리서치를 불러오지 못했어요."
          );
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  };

  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="page">
        <div className="detailSkeleton">
          <div className="sk sk--line sk--w40" />
          <div className="sk sk--line sk--w80" />
          <div className="sk sk--block" />
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="page">
        <ErrorState
          title="회사를 찾을 수 없어요"
          message="이미 삭제됐거나 잘못된 주소일 수 있어요."
          action={
            <Link href="/jobs" className="btn btn--primary">
              공고 피드로 돌아가기
            </Link>
          }
        />
      </div>
    );
  }

  if (error || !company) {
    return (
      <div className="page">
        <ErrorState message={error ?? "알 수 없는 오류"} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="page detail">
      <button
        type="button"
        className="detail__back detail__backBtn"
        onClick={() => router.back()}
      >
        ← 뒤로
      </button>

      <header className="detail__head">
        <div className="detail__companyRow">
          <span className="badge badge--role">회사 리서치</span>
          <SubscribeButton
            companyId={company.id}
            companyName={company.name}
            size="md"
          />
        </div>
        <h1 className="detail__title">{company.name}</h1>
        {company.careersPageUrl ? (
          <a
            href={company.careersPageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="detail__sourceLink"
          >
            공식 채용 페이지 ↗
          </a>
        ) : (
          <p className="detail__company">
            공식 채용 페이지 링크는 아직 등록 전이에요.
          </p>
        )}
      </header>

      {/* ── 외부 데이터 슬롯 (조각 2·3 에서 실데이터로 대체) ── */}
      <ExternalSlot
        title="공시 요약"
        pendingDesc="사업 개요 · 주요 재무 · 최근 이슈를 자소서에 쓰기 좋게 정리해 드릴 예정이에요."
        status={researchStatus}
        company={company}
        searchSuffix="공시"
      />
      <ExternalSlot
        title="인재상 · 핵심가치"
        pendingDesc="채용 페이지·홈페이지에서 인재상/핵심가치를 모아 자소서 관점으로 정리해 드릴 예정이에요."
        status={researchStatus}
        company={company}
        searchSuffix="인재상"
      />

      {/* ── 리서치 노트 (지금 바로 쓸 수 있는 부분) ── */}
      <ResearchNoteEditor
        key={noteKey}
        companyId={company.id}
        initialContent={initialNote}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 외부 데이터 슬롯 — PENDING 이면 "준비 중 + 직접 확인" 폴백(빈 화면 금지).
// 자동 수집 전이라도 사용자가 스스로 원문을 찾도록 채용 페이지/검색 링크를 준다.
// READY 로 바뀌면(조각 2·3) children 자리에 실데이터를 렌더하도록 확장.
// ---------------------------------------------------------------------------
function ExternalSlot({
  title,
  pendingDesc,
  status,
  company,
  searchSuffix,
}: {
  title: string;
  pendingDesc: string;
  status: ResearchStatus;
  company: Company;
  searchSuffix: string;
}) {
  const searchUrl = `https://search.naver.com/search.naver?query=${encodeURIComponent(
    `${company.name} ${searchSuffix}`
  )}`;
  return (
    <section className="detail__section">
      <div className="slot__head">
        <h2 className="detail__sectionTitle">{title}</h2>
        {status === "PENDING" && (
          <span className="badge badge--muted">준비 중</span>
        )}
      </div>
      <div className="fallback">
        <p className="fallback__msg">{pendingDesc}</p>
        <div className="slot__links">
          {company.careersPageUrl && (
            <a
              href={company.careersPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--outline btn--sm"
            >
              채용 페이지에서 확인 ↗
            </a>
          )}
          <a
            href={searchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn--outline btn--sm"
          >
            &ldquo;{company.name} {searchSuffix}&rdquo; 검색 ↗
          </a>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 리서치 노트 편집기 — 회사당 노트 1개. 저장(PUT) / 삭제(빈 내용 또는 삭제 버튼).
// 저장 실패는 비차단: 입력 내용 유지 + 인라인 경고(사용자 글이 날아가지 않게).
// ---------------------------------------------------------------------------
function ResearchNoteEditor({
  companyId,
  initialContent,
}: {
  companyId: string;
  initialContent: string;
}) {
  const [content, setContent] = useState(initialContent);
  /** 마지막으로 서버에 반영된 내용(= trim 기준). 저장/삭제 시 갱신 */
  const [savedContent, setSavedContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = content.trim() !== savedContent.trim();
  const hasSaved = savedContent.trim() !== "";

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setJustSaved(false);
    try {
      const res = await upsertResearchNote(companyId, content);
      const next = res.note?.content ?? "";
      setSavedContent(next);
      setContent(next);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
    } catch (e) {
      setSaveError(
        e instanceof ApiRequestError
          ? e.message
          : "노트 저장에 실패했어요. 입력한 내용은 그대로 있으니 잠시 후 다시 저장해 보세요."
      );
    } finally {
      setSaving(false);
    }
  };

  const removeNote = async () => {
    setSaving(true);
    setSaveError(null);
    setJustSaved(false);
    try {
      await deleteResearchNote(companyId);
      setSavedContent("");
      setContent("");
    } catch (e) {
      setSaveError(
        e instanceof ApiRequestError ? e.message : "노트 삭제에 실패했어요."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="detail__section">
      <div className="slot__head">
        <h2 className="detail__sectionTitle">나의 리서치 노트</h2>
        {hasSaved && !dirty && !justSaved && (
          <span className="noteEditor__saved">저장됨</span>
        )}
        {justSaved && (
          <span className="noteEditor__saved noteEditor__saved--flash">
            저장했어요
          </span>
        )}
      </div>
      <p className="noteEditor__hint">
        이 회사에 지원할 때 참고할 내용을 자유롭게 적어 두세요. 나중에 자소서 쓸 때
        다시 열어볼 수 있어요.
      </p>
      <textarea
        className="noteEditor__area"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="예) 인재상: 도전·자율. 최근 OO 사업 확장 → 성장 경험 강조하기."
        rows={8}
        aria-label="리서치 노트"
      />
      {saveError && (
        <p className="noteEditor__error" role="alert">
          {saveError}
        </p>
      )}
      <div className="noteEditor__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={saving || !dirty}
          onClick={save}
        >
          {saving ? "저장 중…" : "저장"}
        </button>
        {hasSaved && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={saving}
            onClick={removeNote}
          >
            노트 삭제
          </button>
        )}
      </div>
    </section>
  );
}
