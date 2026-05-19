import React from 'react';

/**
 * AvaPromptCard — reusable Ava prompt card for surfaces that want to
 * invite a customer into the AI chat with a contextual prefill.
 *
 * Mirrors the inline Ava widget on Home.jsx (avatar + bubble + click
 * pattern) but parameterised by props so each surface can supply its
 * own copy. Click dispatches the `pgifts:open-chat` custom event that
 * AIChatWidget.jsx listens for — see CLAUDE.md §49 + §56.
 *
 * Used by:
 *   - CategoryPage.jsx — appears below the page title on categories
 *     that have seeded curation rows (gated on `hasCuration`).
 *
 * NOT used by:
 *   - Home.jsx — that surface still inlines its own typewriter version
 *     because the homepage cycles through multiple intent phrases via
 *     AvaTypewriter. Refactoring Home.jsx onto this component is a
 *     separate cleanup (out of scope for §56).
 *
 * @param {object} props
 * @param {string} props.prefill - text injected into chat input on click
 * @param {string} props.welcomeMessage - rendered as the assistant's
 *   opening message in the chat panel after it opens
 * @param {string} props.placeholderText - shown in the bubble on the
 *   card itself (the call-to-action copy the customer sees)
 */
export default function AvaPromptCard({ prefill, welcomeMessage, placeholderText }) {
  const handleClick = () => {
    window.dispatchEvent(new CustomEvent('pgifts:open-chat', {
      detail: { prefill, welcomeMessage },
    }));
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Open Ava AI assistant chat"
      className="w-full rounded-2xl bg-gradient-to-r from-indigo-50 via-white to-purple-50 border border-indigo-100 shadow-md hover:shadow-lg transition-shadow p-5 sm:p-6 group cursor-pointer text-left"
    >
      <div className="flex flex-col sm:flex-row items-center sm:items-stretch gap-4 sm:gap-6">
        {/* Avatar */}
        <div className="flex-shrink-0">
          <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-full overflow-hidden ring-4 ring-indigo-100 shadow-md bg-white">
            <img
              src="/images/ava.png"
              alt="Ava — PGifts AI assistant"
              className="w-full h-full object-cover"
              width="96"
              height="96"
            />
          </div>
        </div>

        {/* Bubble */}
        <div className="flex-1 flex flex-col justify-center min-w-0">
          <span className="text-xs sm:text-sm font-semibold text-indigo-700 mb-2 uppercase tracking-wide">
            Ava — your PGifts assistant
          </span>
          <div className="bg-white rounded-xl rounded-tl-sm px-4 py-3 sm:px-5 sm:py-4 border border-indigo-100 shadow-sm">
            <p className="text-sm sm:text-base text-gray-800">
              {placeholderText}
            </p>
          </div>
          <span className="text-xs text-gray-500 mt-2 group-hover:text-indigo-600 transition-colors">
            Click to chat →
          </span>
        </div>
      </div>
    </button>
  );
}
