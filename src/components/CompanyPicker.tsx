"use client";

// ============================================================================
// 온보딩 "관심 회사 등록"(선택) 섹션 — OS.md 5.3 · 6장 · 12.9 / 12.11
// ----------------------------------------------------------------------------
// - 검색: 입력 → GET /api/companies?keyword= (fetchCompanies) → 결과에서 구독 토글.
//   토글은 SubscribeButton(구독 스토어) 재사용 → 카드/상세와 같은 낙관적 업데이트.
// - 구독의 진실 출처는 CompanySubscription 테이블. 토글 즉시 API 왕복이므로
//   온보딩 "저장" 버튼과 독립이다 — 그 사실을 화면에 명시해 오해를 막는다.
// - 구독 회사 표시: 구독 스토어가 GET /api/subscriptions 의 회사 메타(이름)를 그대로
//   들고 있으므로(12.11 join) 실제 이름을 렌더한다. 구 버전의 "이름 못 불러온 회사
//   N곳" 폴백(회사 184곳 > 시드 limit 100)은 근원이 사라져 제거했다.
// - 각 구독 회사 태그는 회사 리서치 화면(/companies/:id) 진입점을 겸한다(12.11 진입 구조).
// - 이 섹션의 어떤 실패도 온보딩 저장을 막지 않는다(비차단 인라인 에러).
// ============================================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CompanyListItem } from "@/types/contract";
import { fetchCompanies } from "@/lib/api";
import { useSubscriptions } from "@/lib/subscriptions";
import SubscribeButton from "@/components/SubscribeButton";

/** 검색 디바운스(ms). 회사 184곳 규모라 과한 장치는 두지 않는다(M1 규모 존중). */
const SEARCH_DEBOUNCE_MS = 250;
/** 검색 결과 수 — /api/companies 기본값과 동일(회사 선택지 목록으로 충분) */
const SEARCH_LIMIT = 20;

export default function CompanyPicker() {
  const { subscribedCompanies, toggle, isPending } = useSubscriptions();

  const [query, setQuery] = useState("");
  /** null = 아직 검색 안 함(검색 UI 자체를 숨김과 구분) */
  const [results, setResults] = useState<CompanyListItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);

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
  }, [query]);

  const trimmed = query.trim();

  return (
    <section className="formSection">
      <h2 className="formSection__title">
        관심 회사{" "}
        <span className="formSection__hint">
          선택 · 구독하면 피드의 &ldquo;구독 회사만&rdquo; 필터로 모아보고, 회사
          리서치도 여기서 열 수 있어요
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

      {subscribedCompanies.length > 0 && (
        <div className="companyPicker__subscribed">
          <h3 className="companyPicker__subscribedTitle">
            구독 중인 회사 {subscribedCompanies.length}곳 · 이름을 누르면 리서치가
            열려요
          </h3>
          <div className="chips chips--tags">
            {subscribedCompanies.map((c) => {
              const label = c.name ?? "이름 불러오는 중…";
              return (
                <span key={c.companyId} className="tag">
                  <Link
                    href={`/companies/${c.companyId}`}
                    className="tag__link"
                    title={`${label} 리서치 열기`}
                  >
                    {label}
                  </Link>
                  <button
                    type="button"
                    className="tag__remove"
                    aria-label={`${label} 구독 해제`}
                    disabled={isPending(c.companyId)}
                    onClick={() => toggle(c.companyId)}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
