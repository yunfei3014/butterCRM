import React, { useState } from "react";

const KEY = "buttercrm.banner.ai.dismissed";

export function AIBanner({ onOpenChat }: any) {
  const [dismissed, setDismissed] = useState(localStorage.getItem(KEY) === "1");
  if (dismissed) return null;

  const close = () => {
    localStorage.setItem(KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="ai-banner">
      <div className="ai-banner-icon">✨</div>
      <div className="ai-banner-text">
        <strong>AI chat is your default tool.</strong> Don't scroll 11,000 records — type questions like
        <em> "AI founders I haven't met"</em> or <em>"sponsorship targets for next hackathon"</em>. The chat reads all 16k records and answers with citations. Browsing the table is the slow path.
      </div>
      <button className="ai-banner-cta" onClick={onOpenChat}>💬 Open AI chat</button>
      <button className="ai-banner-close" onClick={close} title="Dismiss">✕</button>
    </div>
  );
}
