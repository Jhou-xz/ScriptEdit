import { useEffect, useState } from "react";
import { AppShell } from "@astryxdesign/core";
import { AiChatPanel } from "./components/AiChatPanel";
import { DocumentPanel } from "./components/DocumentPanel";
import { ResizableSplit, usePersistentRatio } from "./components/ResizableSplit";
import { TimelinePanel } from "./components/TimelinePanel";
import { TopNav } from "./components/TopNav";
import { useStore } from "./store/useStore";

export default function App() {
  const { bootstrap, isChatOpen } = useStore();
  const [ready, setReady] = useState(false);
  const [docRatio, setDocRatio] = usePersistentRatio("scriptedit_split_doc", 0.58);
  const [chatRatio, setChatRatio] = usePersistentRatio("scriptedit_split_chat", 0.72);

  useEffect(() => {
    bootstrap().then(() => setReady(true));
  }, [bootstrap]);

  if (!ready) {
    return (
      <div className="token-gate">
        <p className="token-sub">Loading…</p>
      </div>
    );
  }

  const editorLayout = (
    <ResizableSplit
      direction="vertical"
      ratio={docRatio}
      onRatioChange={setDocRatio}
      first={<DocumentPanel />}
      second={<TimelinePanel />}
    />
  );

  return (
    <AppShell height="fill" topNav={<TopNav />}>
      <div className="app-shell-content">
        {isChatOpen ? (
          <ResizableSplit
            direction="horizontal"
            ratio={chatRatio}
            onRatioChange={setChatRatio}
            first={editorLayout}
            second={<AiChatPanel />}
          />
        ) : (
          editorLayout
        )}
      </div>
    </AppShell>
  );
}



