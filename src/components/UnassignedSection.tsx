"use client";

// ============================================================================
// 직무 미분류(통합공채 등) 펼침 구획 — OS.md 12.8(5) / 12.6 명문화된 예외
// ----------------------------------------------------------------------------
// role 필터가 활성일 때 partialHiddenCount 넛지에서 사용자가 "직접 펼쳐서" 여는
// 별도 구획. 필터 결과 목록에는 절대 섞지 않는다(12.6 혼입 금지는 그대로 유효 —
// 이 구획은 사용자 개시 + 구획 분리 + "판정 불가" 라벨을 갖춘 예외일 뿐이다).
//
// - 데이터: GET /api/jobs?role=unassigned — role 만 예약 토큰으로 교체하고
//   location/experience/keyword 등 다른 활성 필터는 그대로 유지(12.6).
// - 카드: 기존 PARTIAL 전용 카드(JobCard) 재사용 — 통합공채는 원문 URL 이
//   1급 요소이므로 원문 확인 CTA 가 그대로 살아 있다.
// - 페이지네이션: 피드와 동일한 커서 "더 보기".
// - 스타일: globals.css 는 이 작업 범위 밖 → 기존 .partialBanner 디자인 언어
//   (경고 톤 배경·테두리)를 컨테이너로 재사용하고 구획 고유 여백만 인라인.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { JobDTO } from "@/types/contract";
import {
  ApiRequestError,
  buildJobsQuery,
  fetchJobs,
  type FeedFilters,
} from "@/lib/api";
import JobCard from "./JobCard";
import { CardSkeletonList, ErrorState } from "./states";

/** 피드 배너의 aria-controls / 스크롤 타깃 앵커 */
export const UNASSIGNED_SECTION_ID = "unassigned-jobs";

// ---- 인라인 스타일(기존 토큰 재사용) ---------------------------------------
// 필터 결과와의 "명확한 구분"은 ① 위쪽 굵은 점선 경계 ② 경고 톤 컨테이너
// (.partialBanner 재사용) 두 겹으로 만든다. sticky 네비를 고려해 scrollMargin.

const wrapStyle: CSSProperties = {
  marginTop: "1.5rem",
  paddingTop: "1.25rem",
  borderTop: "2px dashed var(--border-strong)",
  scrollMarginTop: "4rem",
};

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  padding: "0.9rem 0.9rem 0.75rem",
  outline: "none", // 포커스 이동용 tabIndex=-1 — 링 대신 구획 자체가 시각 신호
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "0.95rem",
  fontWeight: 700,
  color: "var(--warn)",
};

const descStyle: CSSProperties = {
  margin: "0.25rem 0 0",
  fontSize: "0.85rem",
  color: "#7a4f16",
};

const countStyle: CSSProperties = {
  margin: 0,
  fontSize: "0.82rem",
  color: "#7a4f16",
};

const emptyStyle: CSSProperties = {
  margin: 0,
  padding: "0.75rem 0.2rem",
  fontSize: "0.87rem",
  color: "#7a4f16",
};

export default function UnassignedSection({
  filters,
  onCollapse,
}: {
  /** 피드의 현재 필터 — role 만 unassigned 로 교체해 조회한다 */
  filters: FeedFilters;
  /** 구획 하단 "접기" — 배너 토글과 같은 상태를 닫는다 */
  onCollapse: () => void;
}) {
  const [items, setItems] = useState<JobDTO[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const sectionRef = useRef<HTMLElement>(null);

  // role 예약 토큰 unassigned 로 교체(12.6). 다른 활성 필터·정렬은 그대로.
  const unassignedFilters: FeedFilters = { ...filters, roles: ["unassigned"] };
  const queryKey = buildJobsQuery({ ...unassignedFilters, cursor: null });

  // 지역·경력·키워드·마감 필터가 함께 걸려 있는지 — 빈 결과 안내문에 사용
  const hasOtherFilters =
    filters.locations.length > 0 ||
    filters.experiences.length > 0 ||
    filters.keyword.trim() !== "" ||
    filters.deadlineWithin != null;

  // 펼친 직후: 구획은 필터 결과 "아래"에 있어 화면 밖일 수 있다 →
  // 스크롤 + 포커스 이동으로 "펼쳤는데 아무 일도 없음"을 방지.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    el.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
    el.focus({ preventScroll: true });
  }, []);

  // 첫 페이지 로드(필터가 바뀌면 queryKey 가 바뀌어 다시 로드)
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetchJobs({ ...unassignedFilters, cursor: null }, ctrl.signal)
      .then((res) => {
        setItems(res.items);
        setTotalCount(res.totalCount);
        setNextCursor(res.nextCursor);
      })
      .catch((e) => {
        if ((e as Error)?.name === "AbortError") return;
        setError(
          e instanceof ApiRequestError
            ? e.message
            : "미분류 공고를 불러오지 못했어요. 네트워크를 확인해 주세요."
        );
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
    // queryKey 가 필터 변화를 문자열로 안정적으로 감지, retryNonce 로 재시도.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, retryNonce]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    fetchJobs({ ...unassignedFilters, cursor: nextCursor })
      .then((res) => {
        setItems((prev) => [...prev, ...res.items]);
        setNextCursor(res.nextCursor);
      })
      .catch(() => {
        /* 더보기 실패는 조용히 무시(버튼 유지) — 피드와 동일 규약 */
      })
      .finally(() => setLoadingMore(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextCursor, loadingMore, queryKey]);

  return (
    <div style={wrapStyle}>
      <section
        ref={sectionRef}
        id={UNASSIGNED_SECTION_ID}
        className="partialBanner"
        style={sectionStyle}
        aria-labelledby="unassigned-jobs-title"
        tabIndex={-1}
      >
        <header>
          {/* 라벨 문안은 계약(12.8(5)) 확정 문구 그대로 */}
          <h2 id="unassigned-jobs-title" style={titleStyle}>
            직무 미분류(통합공채 등) — 내 필터로는 확인 불가
          </h2>
          <p style={descStyle}>
            직무 정보가 없어 직무 필터로 걸러 드릴 수 없는 공고예요(공공기관
            통합공채 등). 모집 분야는 원문에서 직접 확인하세요.
            {hasOtherFilters &&
              " 지역·경력·키워드 등 다른 필터는 그대로 적용돼 있어요."}
          </p>
        </header>

        {loading ? (
          <CardSkeletonList count={3} />
        ) : error ? (
          <ErrorState
            message={error}
            onRetry={() => setRetryNonce((n) => n + 1)}
          />
        ) : items.length === 0 ? (
          <p style={emptyStyle} role="status">
            {hasOtherFilters
              ? "지금 적용된 지역·경력·키워드 조건과 겹치는 미분류 공고가 없어요. 다른 필터를 넓히면 나타날 수 있어요."
              : "표시할 미분류 공고가 없어요."}
          </p>
        ) : (
          <>
            <p style={countStyle} role="status">
              총 <strong>{totalCount}건</strong>
            </p>
            <ul className="cardList">
              {items.map((job) => (
                <li key={job.id}>
                  <JobCard job={job} />
                </li>
              ))}
            </ul>
            {nextCursor && (
              <div className="feedMore">
                <button
                  type="button"
                  className="btn btn--outline"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? "불러오는 중…" : "미분류 공고 더 보기"}
                </button>
              </div>
            )}
          </>
        )}

        <div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onCollapse}
          >
            ▴ 이 구획 접기
          </button>
        </div>
      </section>
    </div>
  );
}
