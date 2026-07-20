"use client";

// ============================================================================
// 회사 구독 스토어 — OS.md 12.9 (M2a 조각 ②). bookmarks.tsx 패턴 미러링.
// ----------------------------------------------------------------------------
// 진실의 출처는 서버 DB(GET /api/subscriptions). 마운트 시 목록을 한 번 불러와
// {companyId -> subscriptionId} 맵을 만들고, 카드/상세/피드가 이 맵으로
// 구독 상태를 그린다(계약대로 JobDTO 에 구독 필드가 없으므로 companyId 매칭).
// 카드마다 개별 조회하면 N회 왕복 — 전역 1회 로드가 맞다.
//
// 쓰기는 낙관적: 화면 먼저 반영 → 서버 왕복 → 실패 시 롤백 + 토스트.
//   - POST 는 idempotent(이미 구독 중이면 기존 반환) → 재클릭 경합에 안전.
//   - 회사당 구독 1개(companyId UNIQUE) 전제.
// 서버 호출은 src/lib/api.ts 로 일원화(데이터 접근 단일 창구).
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createSubscription,
  deleteSubscription,
  fetchSubscriptions,
} from "@/lib/api";

/** key = companyId, value = subscriptionId */
type SubscriptionMap = Record<string, string>;

interface SubscriptionContextValue {
  /** 초기 구독 로드 완료 여부(로드 전 토글 깜빡임 방지) */
  ready: boolean;
  /** 구독한 회사 수 — 피드 "구독 회사만" 빈 상태 분기의 근거 */
  count: number;
  /** 구독 중인 companyId 목록 — 온보딩 "구독 중인 회사" 표시 근거(조각 ③) */
  companyIds: string[];
  isSubscribed: (companyId: string) => boolean;
  /** 처리 중(중복 클릭 방지 → 버튼 disable) */
  isPending: (companyId: string) => boolean;
  /** 토글: 없으면 구독(POST), 있으면 해제(DELETE) */
  toggle: (companyId: string) => void;
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

  // 초기 로드: 서버의 전체 구독 → 맵
  useEffect(() => {
    let alive = true;
    fetchSubscriptions()
      .then((res) => {
        if (!alive) return;
        const next: SubscriptionMap = {};
        for (const sub of res.items) next[sub.companyId] = sub.id;
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
    async (companyId: string) => {
      setPendingFor(companyId, true);
      // 낙관적: 임시 엔트리 표시
      setMap((prev) => ({ ...prev, [companyId]: `temp_${companyId}` }));
      try {
        const res = await createSubscription(companyId);
        setMap((prev) => ({ ...prev, [companyId]: res.id }));
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
      const existingId = mapRef.current[companyId];
      if (!existingId) return;
      setPendingFor(companyId, true);
      // 낙관적: 즉시 제거
      setMap((prev) => {
        const next = { ...prev };
        delete next[companyId];
        return next;
      });
      try {
        await deleteSubscription(existingId);
      } catch {
        // 롤백: 되살림
        setMap((prev) => ({ ...prev, [companyId]: existingId }));
        showError("구독 해제에 실패했어요. 잠시 후 다시 시도해 주세요.");
      } finally {
        setPendingFor(companyId, false);
      }
    },
    [setPendingFor, showError]
  );

  const toggle = useCallback(
    (companyId: string) => {
      if (mapRef.current[companyId]) void remove(companyId);
      else void add(companyId);
    },
    [add, remove]
  );

  const value: SubscriptionContextValue = {
    ready,
    count: Object.keys(map).length,
    companyIds: Object.keys(map),
    isSubscribed: (companyId) => Boolean(map[companyId]),
    isPending: (companyId) => Boolean(pending[companyId]),
    toggle,
  };

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
