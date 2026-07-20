"use client";

// ============================================================================
// 온보딩 "관심 회사 등록"(선택) 섹션 — OS.md 5.3 · 6장 · 12.9 (M2a 조각 ③)
// ----------------------------------------------------------------------------
// - 검색: 입력 → GET /api/companies?keyword= (fetchCompanies) → 결과에서 구독 토글.
//   토글은 SubscribeButton(구독 스토어) 재사용 → 카드/상세와 같은 낙관적 업데이트.
// - 구독의 진실 출처는 CompanySubscription 테이블. 토글 즉시 API 왕복이므로
//   온보딩 "저장" 버튼과 독립이다 — 그 사실을 화면에 명시해 오해를 막는다.
// - 재진입 대응: 구독 중 회사를 이름으로 표시. 단 계약상 GET /api/subscriptions 엔
//   회사명이 없어(12.9), 마운트 시 회사 목록 1회(limit 100) + 검색 결과로
//   id→이름 캐시를 만들어 해석한다. 해석 안 되는 id 는 "이름을 못 불러온 회사
//   N곳"으로 정직하게 표기(회사 184곳 > limit 상한 100 — 계약 이견으로 보고됨).
// - 이 섹션의 어떤 실패도 온보딩 저장을 막지 않는다(비차단 인라인 에러).
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import type { CompanyListItem } from "@/types/contract";
import { fetchCompanies } from "@/lib/api";
import { useSubscriptions } from "@/lib/subscriptions";
import SubscribeButton from "@/components/SubscribeButton";

/** 검색 디바운스(ms). 회사 184곳 규모라 과한 장치는 두지 않는다(M1 규모 존중). */
const SEARCH_DEBOUNCE_MS = 250;
/** 검색 결과 수 — /api/companies 기본값과 동일(회사 선택지 목록으로 충분) */
const SEARCH_LIMIT = 20;
/** 이름 해석용 시드 로드 상한 — /api/companies 의 MAX_LIMIT */
const NAME_SEED_LIMIT = 100;

export default function CompanyPicker() {
  const { companyIds, toggle, isPending } = useSubscriptions();

  const [query, setQuery] = useState("");
  /** null = 아직 검색 안 함(검색 UI 자체를 숨김과 구분) */
  const [results, setResults] = useState<CompanyListItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);

  /** companyId → 대표 표기명 캐시(구독 목록 표시용) */
  const [names, setNames] = useState<Record<string, string>>({});
  const remember = useCallback((items: CompanyListItem[]) => {
    setNames((prev) => {
      const next = { ...prev };
      for (const c of items) next[c.id] = c.name;
      return next;
    });
  }, []);

  // 이름 해석 시드: 구독 목록(companyId만)을 이름으로 보여주기 위한 1회 로드.
  // 실패해도 조용히 — 검색·조건 저장에는 영향 없고, 아래 폴백 문구로 흡수된다.
  useEffect(() => {
    let alive = true;
    fetchCompanies(undefined, NAME_SEED_LIMIT)
      .then((res) => alive && remember(res.items))
      .catch(() => {
        /* 비차단 — "이름을 못 불러온 회사 N곳" 폴백으로 표시 */
      });
    return () => {
      alive = false;
    };
  }, [remember]);

  // 검색: 디바운스 + 이전 요청 중단. 빈 입력이면 결과 영역을 닫는다.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setSearching(false);
      setSearchError(false);
      return;
    }
    setSearching(true);
    setSearchError(false);
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetchCompanies(q, SEARCH_LIMIT, ctrl.signal)
        .then((res) => {
          remember(res.items);
          setResults(res.items);
          setSearching(false);
        })
        .catch(() => {
          if (ctrl.signal.aborted) return; // 다음 입력이 대체 — 에러 아님
          setSearching(false);
          setSearchError(true);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, remember]);

  const trimmed = query.trim();
  const resolvedIds = companyIds.filter((id) => names[id]);
  const unresolvedCount = companyIds.length - resolvedIds.length;

  return (
    <section className="formSection">
      <h2 className="formSection__title">
        관심 회사{" "}
        <span className="formSection__hint">
          선택 · 구독하면 피드의 &ldquo;구독 회사만&rdquo; 필터로 모아볼 수 있어요
        </span>
      </h2>
      {/* 구독은 즉시 저장(진실 출처 = 서버 구독 테이블) — "저장" 버튼과 독립임을 명시 */}
      <p className="companyPicker__note">
        구독은 선택하는 순간 바로 저장돼요. 아래 &ldquo;저장&rdquo; 버튼과는
        별개예요.
      </p>

      <div className="companyPicker__search">
        <input
          className="input"
          type="search"
          placeholder="회사 이름으로 검색 (예: 카카오)"
          aria-label="관심 회사 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {searching && (
        <p className="companyPicker__status" role="status">
          검색 중…
        </p>
      )}
      {!searching && searchError && (
        <p className="companyPicker__status companyPicker__status--error" role="alert">
          지금 회사 검색이 안 돼요. 조건 저장에는 영향이 없으니 잠시 후 다시
          검색해 보세요.
        </p>
      )}
      {!searching && !searchError && results !== null && (
        results.length === 0 ? (
          <p className="companyPicker__status" role="status">
            &ldquo;{trimmed}&rdquo;와 일치하는 회사가 없어요. 수집된 공고가 있는
            회사만 검색돼요.
          </p>
        ) : (
          <ul className="companyPicker__results">
            {results.map((c) => (
              <li key={c.id} className="companyPicker__row">
                <span className="companyPicker__name">{c.name}</span>
                <SubscribeButton companyId={c.id} companyName={c.name} size="md" />
              </li>
            ))}
          </ul>
        )
      )}

      {companyIds.length > 0 && (
        <div className="companyPicker__subscribed">
          <h3 className="companyPicker__subscribedTitle">
            구독 중인 회사 {companyIds.length}곳
          </h3>
          <div className="chips chips--tags">
            {resolvedIds.map((id) => (
              <span key={id} className="tag">
                {names[id]}
                <button
                  type="button"
                  className="tag__remove"
                  aria-label={`${names[id]} 구독 해제`}
                  disabled={isPending(id)}
                  onClick={() => toggle(id)}
                >
                  ×
                </button>
              </span>
            ))}
            {unresolvedCount > 0 && (
              <span className="tag tag--muted">
                이름을 못 불러온 회사 {unresolvedCount}곳
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
