"use client";

// ============================================================================
// 회사 구독 스토어 — OS.md 12.9 / 12.11. bookmarks.tsx 패턴 미러링.
// ----------------------------------------------------------------------------
// 진실의 출처는 서버 DB(GET /api/subscriptions). 마운트 시 목록을 한 번 불러와
// {companyId -> {subscriptionId, name, careersPageUrl}} 맵을 만들고, 카드/상세/
// 피드/온보딩이 이 맵으로 구독 상태·회사 이름을 그린다.
//   - GET /api/subscriptions 가 회사 메타를 join 해 주므로(12.11) 이름 해석용
//     별도 시드 로드가 필요 없다(구 CompanyPicker 의 limit-100 시드 + "이름 못
//     불러온 회사 N곳" 폴백을 제거하는 근거).
//   - 카드마다 개별 조회하면 N회 왕복 — 전역 1회 로드가 맞다.
//
// 쓰기는 낙관적: 화면 먼저 반영 → 서버 왕복 → 실패 시 롤백 + 토스트.
//   - POST 는 idempotent(이미 구독 중이면 기존 반환) → 재클릭 경합에 안전.
//   - 회사당 구독 1개(companyId UNIQUE) 전제.
//   - 낙관적 add 시 호출부가 아는 회사 메타(이름 등)를 함께 넘겨 즉시 태그로 표시.
//     careersPageUrl 은 호출부가 모를 수 있어(공고 카드) null 이어도 무방 —
//     리서치 화면은 자체 GET 으로 채운다.
// 서버 호출은 src/lib/api.ts 로 일원화(데이터 접근 단일 창구).
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createSubscription,
  deleteSubscription,
  fetchSubscriptions,
} from "@/lib/api";

/** 구독 항목 — 회사 리서치 진입·표기에 필요한 최소 메타 */
export interface SubscriptionEntry {
  subscriptionId: string;
  /** 대표 표기명. 낙관적 add 에서 호출부가 못 넘기면 null(다음 전체 로드에서 채워짐) */
  name: string | null;
  careersPageUrl: string | null;
}

/** 호출부가 낙관적 add 때 함께 넘기는 회사 메타(있으면 즉시 이름 표시) */
export interface CompanyMetaHint {
  name?: string | null;
  careersPageUrl?: string | null;
}

/** key = companyId */
type SubscriptionMap = Record<string, SubscriptionEntry>;

/** 구독 회사(회사 리서치 진입 목록용) */
export interface SubscribedCompany {
  companyId: string;
  name: string | null;
  careersPageUrl: string | null;
}

interface SubscriptionContextValue {
  /** 초기 구독 로드 완료 여부(로드 전 토글 깜빡임 방지) */
  ready: boolean;
  /** 구독한 회사 수 — 피드 "구독 회사만" 빈 상태 분기의 근거 */
  count: number;
  /** 구독 중인 companyId 목록 */
  companyIds: string[];
  /** 구독 중인 회사 목록(이름 포함) — 온보딩 태그·리서치 진입 동선 근거 */
  subscribedCompanies: SubscribedCompany[];
  isSubscribed: (companyId: string) => boolean;
  /** 알고 있으면 회사 표기명, 모르면 null */
  companyName: (companyId: string) => string | null;
  /** 처리 중(중복 클릭 방지 → 버튼 disable) */
  isPending: (companyId: string) => boolean;
  /** 토글: 없으면 구독(POST), 있으면 해제(DELETE). meta 로 회사 이름 힌트 전달 */
  toggle: (companyId: string, meta?: CompanyMetaHint) => void;
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<SubscriptionMap>({});
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);

  // 동기적으로 현재 맵을 읽기 위한 ref(낙관적 롤백에 필요)
  const mapRef = useRef<SubscriptionMap>({});
  mapRef.current = map;

  // 초기 로드: 서버의 전체 구독(회사 메타 join) → 맵
  useEffect(() => {
    let alive = true;
    fetchSubscriptions()
      .then((res) => {
        if (!alive) return;
        const next: SubscriptionMap = {};
        for (const sub of res.items) {
          next[sub.companyId] = {
            subscriptionId: sub.id,
            name: sub.company.name,
            careersPageUrl: sub.company.careersPageUrl,
          };
        }
        setMap(next);
      })
      .catch(() => {
        // 초기 로드 실패해도 앱은 동작(구독 표시만 비어 보임). 조용히 넘어간다.
      })
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const showError = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }, []);

  const setPendingFor = useCallback((companyId: string, v: boolean) => {
    setPending((prev) => {
      if (v) return { ...prev, [companyId]: true };
      const next = { ...prev };
      delete next[companyId];
      return next;
    });
  }, []);

  /** 구독 생성(낙관적) */
  const add = useCallback(
    async (companyId: string, meta?: CompanyMetaHint) => {
      setPendingFor(companyId, true);
      // 낙관적: 임시 엔트리 표시(이름 힌트가 있으면 즉시 태그로 보인다)
      setMap((prev) => ({
        ...prev,
        [companyId]: {
          subscriptionId: `temp_${companyId}`,
          name: meta?.name ?? prev[companyId]?.name ?? null,
          careersPageUrl:
            meta?.careersPageUrl ?? prev[companyId]?.careersPageUrl ?? null,
        },
      }));
      try {
        const res = await createSubscription(companyId);
        setMap((prev) => ({
          ...prev,
          [companyId]: {
            subscriptionId: res.id,
            name: meta?.name ?? prev[companyId]?.name ?? null,
            careersPageUrl:
              meta?.careersPageUrl ?? prev[companyId]?.careersPageUrl ?? null,
          },
        }));
      } catch {
        // 롤백: 임시 엔트리 제거
        setMap((prev) => {
          const next = { ...prev };
          delete next[companyId];
          return next;
        });
        showError("회사 구독에 실패했어요. 잠시 후 다시 시도해 주세요.");
      } finally {
        setPendingFor(companyId, false);
      }
    },
    [setPendingFor, showError]
  );

  /** 구독 해제(낙관적) */
  const remove = useCallback(
    async (companyId: string) => {
      const existing = mapRef.current[companyId];
      if (!existing) return;
      setPendingFor(companyId, true);
      // 낙관적: 즉시 제거
      setMap((prev) => {
        const next = { ...prev };
        delete next[companyId];
        return next;
      });
      try {
        await deleteSubscription(existing.subscriptionId);
      } catch {
        // 롤백: 되살림
        setMap((prev) => ({ ...prev, [companyId]: existing }));
        showError("구독 해제에 실패했어요. 잠시 후 다시 시도해 주세요.");
      } finally {
        setPendingFor(companyId, false);
      }
    },
    [setPendingFor, showError]
  );

  const toggle = useCallback(
    (companyId: string, meta?: CompanyMetaHint) => {
      if (mapRef.current[companyId]) void remove(companyId);
      else void add(companyId, meta);
    },
    [add, remove]
  );

  const value = useMemo<SubscriptionContextValue>(() => {
    const companyIds = Object.keys(map);
    return {
      ready,
      count: companyIds.length,
      companyIds,
      subscribedCompanies: companyIds.map((companyId) => ({
        companyId,
        name: map[companyId].name,
        careersPageUrl: map[companyId].careersPageUrl,
      })),
      isSubscribed: (companyId) => Boolean(map[companyId]),
      companyName: (companyId) => map[companyId]?.name ?? null,
      isPending: (companyId) => Boolean(pending[companyId]),
      toggle,
    };
  }, [map, pending, ready, toggle]);

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
      {toast && (
        <div className="toast" role="alert">
          {toast}
        </div>
      )}
    </SubscriptionContext.Provider>
  );
}

export function useSubscriptions(): SubscriptionContextValue {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) {
    throw new Error(
      "useSubscriptions 는 <SubscriptionProvider> 안에서만 사용할 수 있어요."
    );
  }
  return ctx;
}
