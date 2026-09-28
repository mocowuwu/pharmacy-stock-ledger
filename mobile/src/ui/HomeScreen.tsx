import { readQueue } from "../lib/store";
import { Bar } from "./components";
import { useApp } from "./context";
import { Icon, type IconName } from "./icons";

function Row({ icon, title, meta, onClick }: { icon: IconName; title: string; meta?: string; onClick: () => void }) {
  return (
    <button className="list-row" onClick={onClick}>
      <span className="glyph">
        <Icon name={icon} />
      </span>
      <span className="body">
        <span className="title">{title}</span>
        {meta ? <span className="meta">{meta}</span> : null}
      </span>
      <span className="chev">
        <Icon name="chevron" />
      </span>
    </button>
  );
}

/** The app's own menu, for when the website is not the answer. */
export function HomeScreen() {
  const { t, device, go, revision } = useApp();
  void revision;
  if (!device) return null;
  const pending = readQueue().sales.length;
  const till = device.role === "till";

  return (
    <div className="screen">
      <Bar
        title={device.deviceName}
        sub={`${till ? t("home.roleTill") : t("home.roleManagement")}${device.deviceCode ? ` · ${device.deviceCode}` : ""}`}
        onBack={() => go("/login")}
      />
      <main>
        <div className="card flush">
          <Row icon="globe" title={t("home.openWebsite")} meta={t("home.openWebsiteHint")} onClick={() => go("/start")} />
          <Row icon="user" title={t("home.signIn")} meta={t("home.signInHint")} onClick={() => go("/login")} />
        </div>
        {till || pending > 0 ? (
          <div className="card flush">
            {till ? (
              <Row icon="store" title={t("home.offlineTill")} meta={t("home.offlineTillHint")} onClick={() => go("/offline")} />
            ) : null}
            <Row
              icon="receipt"
              title={t("home.queue")}
              meta={pending > 0 ? t("status.waiting", { n: pending }) : t("home.queueHint")}
              onClick={() => go("/queue")}
            />
          </div>
        ) : null}
        <div className="card flush">
          <Row icon="settings" title={t("home.setup")} meta={device.serverUrl.replace(/^https?:\/\//u, "")} onClick={() => go("/setup")} />
        </div>
      </main>
    </div>
  );
}
