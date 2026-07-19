"use client";

// 회사 구독 토글 버튼 — "공고 저장(★)"과 구분되는 회사 단위 액션 (OS.md 12.9).
// 카드에서는 회사 이름 옆(sm), 상세에서는 회사 이름 줄(md)에 놓인다.
// 카드의 stretched-link 위에 떠야 하므로 z-index 를 갖고, 클릭 전파를 막는다.
// companyId 가 null 인 공고(회사 미확인)에는 이 버튼을 렌더링하지 않는다(호출부 책임).
import { useSubscriptions } from "@/lib/subscriptions";

export default function SubscribeButton({
  companyId,
  companyName,
  size = "sm",
}: {
  companyId: string;
  /** 접근성 레이블용("<회사명> 구독") — 화면에는 짧은 라벨만 표시 */
  companyName: string;
  size?: "sm" | "md";
}) {
  const { isSubscribed, toggle, ready, isPending } = useSubscriptions();
  const on = isSubscribed(companyId);
  const pending = isPending(companyId);

  return (
    <button
      type="button"
      className={`subscribeBtn subscribeBtn--${size}${
        on ? " subscribeBtn--on" : ""
      }`}
      aria-pressed={on}
      aria-label={on ? `${companyName} 구독 해제` : `${companyName} 구독`}
      title={
        on
          ? "구독 해제"
          : "구독하면 피드의 ‘구독 회사만’ 필터로 이 회사 공고를 모아볼 수 있어요"
      }
      disabled={!ready || pending}
      onClick={(e) => {
        // 카드 전체 링크(stretched link) 클릭으로 전파되지 않게 막는다.
        e.preventDefault();
        e.stopPropagation();
        toggle(companyId);
      }}
    >
      <span aria-hidden="true">{on ? "✓" : "+"}</span>
      {on ? "구독중" : "구독"}
    </button>
  );
}
