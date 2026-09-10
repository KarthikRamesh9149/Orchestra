import { useCallback, useState } from "react";

type SelectionBubble = {
  text: string;
  x: number;
  y: number;
};

export function useAddSelectionToChat() {
  const [bubble, setBubble] = useState<SelectionBubble | null>(null);

  const captureSelection = useCallback(() => {
    window.setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";
      if (!selection || text.length < 2 || selection.rangeCount === 0) {
        setBubble(null);
        return;
      }

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        setBubble(null);
        return;
      }

      setBubble({
        text: text.slice(0, 2000),
        x: Math.min(window.innerWidth - 130, Math.max(12, rect.left + rect.width / 2 - 55)),
        y: Math.max(12, rect.top - 42)
      });
    }, 0);
  }, []);

  const clearSelectionBubble = useCallback(() => {
    window.setTimeout(() => setBubble(null), 160);
  }, []);

  const addSelectionToChat = useCallback(() => {
    if (!bubble) return;
    window.dispatchEvent(
      new CustomEvent("orchestra:add-to-socrates", {
        detail: { text: bubble.text }
      })
    );
    window.getSelection()?.removeAllRanges();
    setBubble(null);
  }, [bubble]);

  const bubbleElement = bubble ? (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={addSelectionToChat}
      className="fixed z-[80] rounded-full border border-[rgba(26,22,18,0.1)] bg-white px-3 py-2 font-sans text-[12px] text-[#1A1612] shadow-[0_10px_30px_rgba(26,22,18,0.18)] transition-colors hover:bg-[#FAF8F5]"
      style={{ left: bubble.x, top: bubble.y }}
    >
      Add to chat
    </button>
  ) : null;

  return {
    captureSelection,
    clearSelectionBubble,
    bubbleElement
  };
}
