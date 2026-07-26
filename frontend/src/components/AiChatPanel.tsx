import { useState, useEffect, useRef } from "react";
import {
  Badge,
  Button,
  Card,
  ChatComposer,
  ChatComposerInput,
  ChatLayout,
  ChatMessage as AstryxChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatSendButton,
  Selector,
} from "@astryxdesign/core";
import { useStore } from "../store/useStore";
import type { Block } from "../api/client";

interface ProposalPayload {
  block_id: number;
  action: "update_content" | "editor_note" | "retime";
  original_text?: string;
  proposed_text?: string;
  reason?: string;
}

function parseProposals(text: string): { cleanText: string; proposals: ProposalPayload[] } {
  const proposals: ProposalPayload[] = [];
  const regex = /```json:proposal\s*([\s\S]*?)\s*```/g;
  let match;
  let cleanText = text;

  while ((match = regex.exec(text)) !== null) {
    try {
      const payload = JSON.parse(match[1]) as ProposalPayload;
      if (payload && payload.block_id) {
        proposals.push(payload);
      }
    } catch {
      // ignore JSON parse errors during streaming
    }
  }

  cleanText = cleanText.replace(regex, "").trim();
  return { cleanText, proposals };
}

function ProposalCard({
  proposal,
  onApplied,
}: {
  proposal: ProposalPayload;
  onApplied: () => void;
}) {
  const { blocks, updateBlockContent, updateBlock } = useStore();
  const [applied, setApplied] = useState(false);
  const [rejected, setRejected] = useState(false);

  const block = blocks[proposal.block_id] as Block | undefined;
  if (!block) return null;

  const handleApply = async () => {
    if (proposal.action === "update_content" && proposal.proposed_text) {
      const tiptapJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: proposal.proposed_text }],
          },
        ],
      };
      await updateBlockContent(proposal.block_id, tiptapJson);
    } else if (proposal.action === "editor_note" && proposal.proposed_text) {
      await updateBlock(proposal.block_id, { editor_note: proposal.proposed_text });
    }
    setApplied(true);
    onApplied();
  };

  return (
    <Card className="proposal-card" style={{ marginTop: "12px", borderLeft: "3px solid #2997ff" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Badge label="AI Proposal" variant="info" />
          <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: 600 }}>
            Block #{proposal.block_id} ({block.title || "Voiceover"})
          </span>
        </div>
        {applied && <Badge label="Applied ✓" variant="success" />}
        {rejected && <Badge label="Rejected" variant="warning" />}
      </div>

      {proposal.reason && (
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px", fontStyle: "italic" }}>
          "{proposal.reason}"
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" }}>
        {proposal.original_text && (
          <div style={{ background: "rgba(224, 108, 108, 0.15)", padding: "6px 10px", borderRadius: "4px", borderLeft: "2px solid #e06c6c" }}>
            <span style={{ fontSize: "11px", color: "#e06c6c", display: "block", marginBottom: "2px", fontWeight: 600 }}>BEFORE</span>
            <span style={{ textDecoration: "line-through", color: "var(--text-muted)" }}>{proposal.original_text}</span>
          </div>
        )}
        {proposal.proposed_text && (
          <div style={{ background: "rgba(41, 151, 255, 0.15)", padding: "6px 10px", borderRadius: "4px", borderLeft: "2px solid #2997ff" }}>
            <span style={{ fontSize: "11px", color: "#2997ff", display: "block", marginBottom: "2px", fontWeight: 600 }}>AFTER (PROPOSED)</span>
            <span>{proposal.proposed_text}</span>
          </div>
        )}
      </div>

      {!applied && !rejected && (
        <div style={{ display: "flex", gap: "8px", marginTop: "12px", justifyContent: "flex-end" }}>
          <Button
            label="Reject"
            variant="ghost"
            size="sm"
            onClick={() => setRejected(true)}
          />
          <Button
            label="Apply Edit"
            variant="primary"
            size="sm"
            onClick={handleApply}
          />
        </div>
      )}
    </Card>
  );
}function fmtTime(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function AiChatPanel() {
  const {
    blocks,
    tracks,
    activeBlockId,
    setActiveBlock,
    chatMessages,
    isChatStreaming,
    webSearchEnabled,
    toggleWebSearch,
    sendChatMessage,
    clearChatMessages,
    setChatOpen,
  } = useStore();

  const [inputPrompt, setInputPrompt] = useState("");
  const [selectedTargetId, setSelectedTargetId] = useState<number | null>(null);
  const [toastNotice, setToastNotice] = useState<string | null>(null);
  const prevTargetId = useRef<number | null>(null);

  const effectiveTargetId = selectedTargetId ?? activeBlockId;
  const targetBlock = effectiveTargetId ? blocks[effectiveTargetId] : null;

  useEffect(() => {
    if (effectiveTargetId && effectiveTargetId !== prevTargetId.current) {
      const b = blocks[effectiveTargetId];
      if (b) {
        const title = b.title || `Block #${b.id}`;
        const timeRange = `${fmtTime(b.start_seconds)}–${fmtTime(b.start_seconds + b.duration_seconds)}`;
        setToastNotice(`Section "${title}" [${timeRange}] included in chat`);
        const timer = setTimeout(() => setToastNotice(null), 3500);
        prevTargetId.current = effectiveTargetId;
        return () => clearTimeout(timer);
      }
    }
    prevTargetId.current = effectiveTargetId;
  }, [effectiveTargetId, blocks]);

  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const voBlocks = Object.values(blocks)
    .filter((b) => trackById.get(b.track)?.is_script_track)
    .sort((a, b) => a.start_seconds - b.start_seconds);

  const blockOptions = voBlocks.map((b) => {
    const startStr = fmtTime(b.start_seconds);
    const endStr = fmtTime(b.start_seconds + b.duration_seconds);
    const title = b.title || b.content_markdown?.slice(0, 25) || "VO Section";
    return {
      value: String(b.id),
      label: `[${startStr} - ${endStr}] Block #${b.id}: ${title}`,
    };
  });

  const handleSend = () => {
    if (!inputPrompt.trim() || isChatStreaming) return;
    const text = inputPrompt.trim();
    setInputPrompt("");
    sendChatMessage(text, effectiveTargetId);
  };

  return (
    <div className="ai-chat-panel">
      {/* Header */}
      <div className="ai-chat-header">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--text-primary)" }}>
            Script Editing Copilot
          </span>
          {isChatStreaming && <Badge label="Thinking…" variant="info" />}
          {webSearchEnabled && <Badge label="🌐 Web Research Active" variant="blue" />}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Button
            label={webSearchEnabled ? "🌐 Research ON" : "🌐 Research OFF"}
            variant={webSearchEnabled ? "primary" : "secondary"}
            size="sm"
            onClick={toggleWebSearch}
          />
          <Button
            label="Clear"
            variant="ghost"
            size="sm"
            onClick={clearChatMessages}
          />
          <button
            className="doc-icon-btn"
            title="Close Assistant"
            onClick={() => setChatOpen(false)}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Target Section Context Banner & Toast Notification */}
      <div className="ai-chat-context-banner">
        {toastNotice && (
          <div style={{ background: "var(--color-accent-dim)", border: "1px solid var(--color-accent)", color: "#ffffff", padding: "6px 10px", borderRadius: "6px", fontSize: "12px", marginBottom: "8px", display: "flex", alignItems: "center", justifyContent: "space-between", animation: "fadeIn 0.2s ease" }}>
            <span>✨ {toastNotice}</span>
            <button onClick={() => setToastNotice(null)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: "0 4px" }}>✕</button>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <span style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)", fontWeight: 600 }}>
            Active Section Context
          </span>
          {effectiveTargetId && (
            <button
              className="context-clear-btn"
              onClick={() => {
                setSelectedTargetId(null);
                setActiveBlock(null);
              }}
              title="Clear selection to ask about full script"
            >
              Clear Context ×
            </button>
          )}
        </div>

        <Selector
          label="Target section"
          isLabelHidden
          placeholder="Entire Script (All Sections Included)"
          value={effectiveTargetId ? String(effectiveTargetId) : ""}
          options={blockOptions}
          onChange={(val) => setSelectedTargetId(val ? Number(val) : null)}
          size="sm"
        />

        {targetBlock ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "6px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text-secondary)" }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: trackById.get(targetBlock.track)?.color ?? "#2997ff",
                }}
              />
              <span style={{ fontWeight: 600 }}>{targetBlock.title || `Block #${targetBlock.id}`}</span>
              <span>· ⏱️ {fmtTime(targetBlock.start_seconds)} – {fmtTime(targetBlock.start_seconds + targetBlock.duration_seconds)}</span>
              <span>· {targetBlock.word_count} words</span>
            </div>
            <Button
              label="✨ Quick Suggestion"
              variant="primary"
              size="sm"
              onClick={() => useStore.getState().requestBlockSuggestion(targetBlock.id)}
            />

          </div>
        ) : (

          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px", fontStyle: "italic" }}>
            Full Script Mode: Asking questions with knowledge of all sections.
          </div>
        )}
      </div>

      {/* Chat Messages */}
      <div className="ai-chat-messages-wrap">
        <ChatLayout
          composer={
            <ChatComposer
              onSubmit={handleSend}
              drawer={
                targetBlock ? (
                  <div style={{ padding: "4px 8px", display: "flex", alignItems: "center", gap: "6px" }}>
                    <Badge
                      label={`🎯 Focused Section [${fmtTime(targetBlock.start_seconds)} - ${fmtTime(targetBlock.start_seconds + targetBlock.duration_seconds)}]: ${targetBlock.title || `Block #${targetBlock.id}`}`}
                      variant="blue"
                    />
                    <button
                      style={{
                        background: "rgba(255, 255, 255, 0.15)",
                        border: "none",
                        borderRadius: "50%",
                        color: "#ffffff",
                        width: "18px",
                        height: "18px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        fontSize: "11px",
                        lineHeight: 1,
                      }}
                      title="Clear section focus & return to general script chat"
                      onClick={() => {
                        setSelectedTargetId(null);
                        setActiveBlock(null);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ) : undefined
              }
              input={
                <ChatComposerInput
                  placeholder={webSearchEnabled ? "Search web & ask Copilot for facts, B-roll, or revisions..." : "Ask Script Editing Copilot to revise prose, re-time clips, or analyze full script..."}
                  value={inputPrompt}
                  onChange={(val) => setInputPrompt(val)}
                  onSubmit={handleSend}
                />
              }

              sendButton={
                <ChatSendButton
                  isDisabled={!inputPrompt.trim() || isChatStreaming}
                  onClick={handleSend}
                />
              }
            />
          }
        >


          <ChatMessageList>
            {chatMessages.length === 0 && (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-muted)" }}>
                <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
                  Script Editing Copilot
                </p>
                <p style={{ fontSize: "12px", lineHeight: 1.5 }}>
                  I have full context of your entire script by default. Ask general questions about pacing, structure, or tone, or click any section in the document review or timeline to target specific edits.
                </p>
              </div>
            )}

            {chatMessages.map((msg) => {
              const isUser = msg.role === "user";
              const { cleanText, proposals } = parseProposals(msg.content);

              return (
                <AstryxChatMessage key={msg.id} sender={isUser ? "user" : "assistant"}>
                  <ChatMessageBubble variant={isUser ? "filled" : "ghost"}>
                    {msg.targetBlockId && isUser && (
                      <div style={{ fontSize: "11px", color: "var(--color-accent)", marginBottom: "4px", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}>
                        <span>🎯 Included Section: Block #{msg.targetBlockId}</span>
                      </div>
                    )}
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5, fontSize: "13px" }}>
                      {cleanText || (isChatStreaming && !isUser ? "Thinking…" : "")}
                    </div>

                    {proposals.map((prop, idx) => (
                      <ProposalCard
                        key={`${msg.id}-prop-${idx}`}
                        proposal={prop}
                        onApplied={() => {}}
                      />
                    ))}
                  </ChatMessageBubble>
                </AstryxChatMessage>
              );
            })}
          </ChatMessageList>
        </ChatLayout>
      </div>
    </div>
  );
}


