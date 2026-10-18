"use client";

// Copy-to-clipboard button for the public status page. Client-only because the
// clipboard API does not exist on the server; everything else on the page is
// server-rendered.
import { useState } from "react";
import PropTypes from "prop-types";

export default function CopyButton({ text, label = "Copy", copiedLabel = "Copied", title }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied (insecure origin, permissions): leave the text
      // selectable rather than pretending the copy happened.
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      title={title || label}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:border-primary/40 hover:text-primary"
    >
      <span className="material-symbols-outlined text-[14px]">{copied ? "check" : "content_copy"}</span>
      {copied ? copiedLabel : label}
    </button>
  );
}

CopyButton.propTypes = {
  text: PropTypes.string.isRequired,
  label: PropTypes.string,
  copiedLabel: PropTypes.string,
  title: PropTypes.string,
};
