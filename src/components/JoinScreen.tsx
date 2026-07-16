import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Moon, Sun } from "lucide-react";
import type { JoinParams } from "../hooks/useGameRoom";
import { useRoomLobby } from "../hooks/useGameRoom";
import {
  CAMPAIGN_DESCRIPTION_CAP,
  loadMergedCampaigns,
  registerCampaignRoom,
} from "../lib/campaignRegistry";
import {
  generateRoomId,
  loadRoomKey,
  saveRoomKey,
  upsertSavedCampaign,
  type SavedCampaign,
} from "../lib/savedCampaigns";
import { uploadLibraryImage } from "../lib/uploadAsset";
import type { Role } from "../lib/types";

type JoinScreenProps = {
  onJoin: (params: JoinParams & { roomId: string }) => void;
  /** Device theme (day parchment / night stone), lifted to App so it applies everywhere. */
  nightMode: boolean;
  onToggleNight: (on: boolean) => void;
};

/// <summary>
/// Lobby: pick or create a campaign, choose DM or player, then join. Player role loads the
/// room's open character slots.
/// </summary>
export function JoinScreen({ onJoin, nightMode, onToggleNight }: JoinScreenProps) {
  const [campaigns, setCampaigns] = useState<SavedCampaign[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [role, setRole] = useState<Role>("dm");
  const [dmName, setDmName] = useState("DM");
  const [roomKey, setRoomKey] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const refreshCampaigns = () => {
    loadMergedCampaigns()
      .then((list) => {
        setCampaigns(list);
        setSelectedRoomId((current) => current || list[0]?.roomId || "");
      })
      .catch(() => setCampaigns([]));
  };

  useEffect(refreshCampaigns, []);

  useEffect(() => {
    if (selectedRoomId) {
      setRoomKey(loadRoomKey(selectedRoomId));
    }
  }, [selectedRoomId]);

  const lobby = useRoomLobby(selectedRoomId, role === "player" && Boolean(selectedRoomId));
  const availableSlots = lobby.availableSlots;

  const selectedCampaign = campaigns.find((campaign) => campaign.roomId === selectedRoomId);

  const canJoin = useMemo(() => {
    if (!selectedRoomId) return false;
    if (role === "dm") return dmName.trim().length > 0;
    return selectedSlotId.length > 0;
  }, [selectedRoomId, role, dmName, selectedSlotId]);

  const handleJoin = () => {
    if (!canJoin) return;
    saveRoomKey(selectedRoomId, roomKey);
    upsertSavedCampaign(selectedRoomId, selectedCampaign?.name);
    if (role === "dm") {
      onJoin({ roomId: selectedRoomId, role: "dm", displayName: dmName.trim(), roomKey });
    } else {
      onJoin({ roomId: selectedRoomId, role: "player", slotId: selectedSlotId, roomKey });
    }
  };

  return (
    <div className="lobby">
      <div className="lobby-card">
        <button
          className="btn-ghost icon-btn lobby-night-toggle"
          title={nightMode ? "Day mode — parchment and ink" : "Night mode — carved stone and chalk"}
          onClick={() => onToggleNight(!nightMode)}
        >
          {nightMode ? <Sun size={16} strokeWidth={2.2} /> : <Moon size={15} strokeWidth={2.2} />}
        </button>
        <h1>Campaign Manager</h1>
        <p className="lobby-sub">Choose a campaign and take your seat at the table.</p>

        <div className="lobby-columns">
          <div className="stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="section-title" style={{ margin: 0 }}>
                Campaigns
              </span>
              <button onClick={() => setShowCreate(true)}>+ New</button>
            </div>
            <div className="campaign-list">
              {campaigns.length === 0 ? (
                <span className="muted">No campaigns yet — create one.</span>
              ) : null}
              {campaigns.map((campaign) => (
                <button
                  key={campaign.roomId}
                  className={`campaign-item${campaign.roomId === selectedRoomId ? " selected" : ""}`}
                  onClick={() => setSelectedRoomId(campaign.roomId)}
                >
                  {campaign.iconUrl ? <img src={campaign.iconUrl} alt="" /> : null}
                  <span>{campaign.name}</span>
                </button>
              ))}
            </div>
            {selectedCampaign ? (
              <div className="campaign-description">
                {selectedCampaign.description ? (
                  selectedCampaign.description
                ) : (
                  <span className="muted">No description yet.</span>
                )}
              </div>
            ) : null}
          </div>

          <div className="stack">
            <span className="section-title" style={{ margin: 0 }}>
              Join as
            </span>
            <div className="role-toggle">
              <button
                className={role === "dm" ? "btn-active" : ""}
                onClick={() => setRole("dm")}
              >
                Dungeon Master
              </button>
              <button
                className={role === "player" ? "btn-active" : ""}
                onClick={() => setRole("player")}
              >
                Player
              </button>
            </div>

            {role === "dm" ? (
              <div className="field">
                <label>Your name</label>
                <input
                  value={dmName}
                  onChange={(e) => setDmName(e.target.value)}
                  placeholder="Dungeon Master"
                />
              </div>
            ) : (
              <div className="field">
                <label>Character slot</label>
                {lobby.status === "connecting" ? (
                  <span className="muted">Loading slots…</span>
                ) : availableSlots.length === 0 ? (
                  <span className="muted">No open slots. Ask the DM to add one.</span>
                ) : (
                  <div className="slot-list">
                    {availableSlots.map((slot) => (
                      <button
                        key={slot.id}
                        className={slot.id === selectedSlotId ? "btn-active" : ""}
                        onClick={() => setSelectedSlotId(slot.id)}
                      >
                        {slot.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="field">
              <label>Room password (optional)</label>
              <input
                type="password"
                value={roomKey}
                onChange={(e) => setRoomKey(e.target.value)}
                placeholder="Leave blank if none"
              />
            </div>

            <button className="btn-primary" disabled={!canJoin} onClick={handleJoin}>
              Enter campaign
            </button>
          </div>
        </div>
      </div>

      {showCreate
        ? createPortal(
            <CreateCampaignModal
              onClose={() => setShowCreate(false)}
              onCreated={(roomId) => {
                setShowCreate(false);
                setSelectedRoomId(roomId);
                refreshCampaigns();
              }}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

/// <summary>
/// Modal for creating a new campaign room: name + optional icon, registered so everyone sees it.
/// </summary>
function CreateCampaignModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (roomId: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  // Preview the chosen icon without re-creating the object URL every render (which would
  // reload the <img> and leak URLs); revoke it when the file changes or the modal closes.
  const iconPreviewUrl = useMemo(() => (iconFile ? URL.createObjectURL(iconFile) : null), [iconFile]);
  useEffect(() => () => {
    if (iconPreviewUrl) URL.revokeObjectURL(iconPreviewUrl);
  }, [iconPreviewUrl]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    const roomId = generateRoomId();
    const trimmedDescription = description.trim() || null;
    try {
      let iconUrl: string | null = null;
      if (iconFile) {
        // Store the icon as a normal room asset so it's manageable on the Assets page.
        iconUrl = (await uploadLibraryImage(roomId, iconFile)).url;
      }
      await registerCampaignRoom({ roomId, name: trimmed, iconUrl, description: trimmedDescription });
      upsertSavedCampaign(roomId, { name: trimmed, iconUrl, description: trimmedDescription });
      onCreated(roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the campaign.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal stack" onClick={(e) => e.stopPropagation()}>
        <h2>New campaign</h2>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="The Sunken Keep" />
        </div>
        <div className="field">
          <label>Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={CAMPAIGN_DESCRIPTION_CAP}
            placeholder="A short blurb players see when they pick this campaign."
          />
        </div>
        <div className="field">
          <label>Icon (optional)</label>
          <div className="row" style={{ alignItems: "center", gap: "0.6rem" }}>
            {iconFile ? (
              <img className="campaign-icon-preview" src={iconPreviewUrl ?? undefined} alt="" />
            ) : (
              <span className="campaign-icon-preview campaign-icon-preview--empty" aria-hidden="true" />
            )}
            <button type="button" onClick={() => iconInputRef.current?.click()}>
              {iconFile ? "Change image…" : "Choose image…"}
            </button>
            {iconFile ? (
              <button type="button" onClick={() => setIconFile(null)}>
                Remove
              </button>
            ) : null}
            <input
              ref={iconInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => setIconFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        {error ? <span className="muted" style={{ color: "var(--danger-text)" }}>{error}</span> : null}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !name.trim()} onClick={() => void create()}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
