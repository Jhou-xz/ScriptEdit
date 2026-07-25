import { useEffect, useState } from "react";
import { DocumentPanel } from "./components/DocumentPanel";
import { ResizableSplit, usePersistentRatio } from "./components/ResizableSplit";
import { TimelinePanel } from "./components/TimelinePanel";
import { TopNav } from "./components/TopNav";
import { useStore } from "./store/useStore";

export default function App() {
  const { bootstrap } = useStore();
  const [ready, setReady] = useState(false);
  const [docRatio, setDocRatio] = usePersistentRatio("scriptedit_split_doc", 0.58);

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

  return (
    <div className="app-shell">
      <TopNav />
      <ResizableSplit
        direction="vertical"
        ratio={docRatio}
        onRatioChange={setDocRatio}
        first={<DocumentPanel />}
        second={<TimelinePanel />}
      />
    </div>
  );
}
