import React from 'react';
import { Sparkles } from 'lucide-react';

/**
 * AvaPromptCard — category-page invitation to ask Ava for advice.
 *
 * Positions Ava as a product advisor (not a filter): a headline, a subline
 * and 2–3 example prompts written as real customer needs. Clicking an
 * example opens the chat with that question already SENT (`autoSend`);
 * clicking "Ask Ava" opens the chat with the category welcome message.
 * Both dispatch the `pgifts:open-chat` event AIChatWidget listens for
 * (CLAUDE.md §49, §56, §65.7).
 *
 * Used by CategoryPage.jsx only. Home.jsx keeps its own Ava card.
 *
 * @param {object} props
 * @param {string[]} props.examples - example prompts (checked against Ava's answers before shipping)
 * @param {string} props.welcomeMessage - assistant opening message for the "Ask Ava" button
 */
export default function AvaPromptCard({ examples = [], welcomeMessage }) {
  const openChat = (detail) => {
    window.dispatchEvent(new CustomEvent('pgifts:open-chat', { detail }));
  };

  return (
    <section
      aria-label="Ask Ava, our product advisor"
      className="w-full rounded-2xl bg-gradient-to-r from-indigo-50 via-white to-purple-50 border border-indigo-100 shadow-md p-5 sm:p-6"
    >
      <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6">
        <div className="flex-shrink-0">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden ring-4 ring-indigo-100 shadow-md bg-white">
            <img
              src="/images/ava.png?v=2"
              alt="Ava — PGifts product advisor"
              className="w-full h-full object-cover"
              width="80"
              height="80"
            />
          </div>
        </div>

        <div className="flex-1 min-w-0 text-center sm:text-left">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Not sure which to choose? Ask Ava</h2>
          <p className="text-sm sm:text-base text-gray-700 mt-1">
            Tell her about your event, how many you need, your budget and how you&apos;d like it
            printed — she&apos;ll recommend the right product and price it for you.
          </p>

          {examples.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-2">Try asking</p>
              <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
                {examples.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => openChat({ prefill: q, welcomeMessage, autoSend: true })}
                    className="text-left text-sm px-3 py-2 rounded-xl bg-white border border-indigo-200 text-indigo-900 hover:border-indigo-400 hover:bg-indigo-50 transition-colors shadow-sm"
                  >
                    “{q}”
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => openChat({ welcomeMessage })}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
          >
            <Sparkles className="h-4 w-4" />
            Ask Ava your own question
          </button>
        </div>
      </div>
    </section>
  );
}
