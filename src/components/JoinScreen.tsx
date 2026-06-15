import { useEffect, useMemo, useState } from "react";
import type { JoinParams } from "../hooks/useGameRoom";
import { useRoomLobby } from "../hooks/useGameRoom";
import type { Role } from "../lib/types";

type JoinScreenProps = {
  onJoin: (params: JoinParams & { roomId: string }) => void;
};

/// <summary>
/// Collects room credentials and slot selection before connecting to a session.
/// </summary>
export function JoinScreen({ onJoin }: JoinScreenProps) {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [roomId, setRoomId] = useState(params.get("room") ?? "campaign1");
  const [roomKey, setRoomKey] = useState(params.get("key") ?? "");
  const [dmName, setDmName] = useState(localStorage.getItem("cm-dm-name") ?? "DM");
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [role, setRole] = useState<Role>(
    params.get("role") === "dm" ? "dm" : "player",
  );

  const lobby = useRoomLobby(roomId, role === "player");

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    if (roomKey) {
      url.searchParams.set("key", roomKey);
    } else {
      url.searchParams.delete("key");
    }
    url.searchParams.set("role", role);
    window.history.replaceState({}, "", url.toString());
  }, [roomId, roomKey, role]);

  useEffect(() => {
    if (!selectedSlotId) {
      return;
    }
    if (!lobby.availableSlots.some((slot) => slot.id === selectedSlotId)) {
      setSelectedSlotId(null);
    }
  }, [lobby.availableSlots, selectedSlotId]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!roomId.trim()) {
      return;
    }

    if (role === "dm") {
      const displayName = dmName.trim() || "DM";
      localStorage.setItem("cm-dm-name", displayName);
      onJoin({
        roomId: roomId.trim(),
        role: "dm",
        displayName,
        roomKey: roomKey.trim(),
      });
      return;
    }

    if (!selectedSlotId) {
      return;
    }

    onJoin({
      roomId: roomId.trim(),
      role: "player",
      slotId: selectedSlotId,
      roomKey: roomKey.trim(),
    });
  };

  const selectedSlot = lobby.state?.playerSlots.find((slot) => slot.id === selectedSlotId);

  return (
    <div className="join-screen">
      <div className="join-card">
        <h1>Campaign Manager</h1>
        <p className="subtitle">DM-controlled maps for your table. Players join as a character slot.</p>
        <form onSubmit={handleSubmit}>
          <label>
            Room ID
            <input
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
              placeholder="campaign1"
              required
            />
          </label>
          <label>
            Room password (optional)
            <input
              value={roomKey}
              onChange={(event) => setRoomKey(event.target.value)}
              placeholder="shared secret"
              type="password"
            />
          </label>
          <fieldset className="role-picker">
            <legend>Join as</legend>
            <label className="role-option">
              <input
                type="radio"
                name="role"
                checked={role === "dm"}
                onChange={() => setRole("dm")}
              />
              Dungeon Master
            </label>
            <label className="role-option">
              <input
                type="radio"
                name="role"
                checked={role === "player"}
                onChange={() => setRole("player")}
              />
              Player
            </label>
          </fieldset>

          {role === "dm" ? (
            <label>
              Your name (optional)
              <input
                value={dmName}
                onChange={(event) => setDmName(event.target.value)}
                placeholder="DM"
              />
            </label>
          ) : (
            <fieldset className="slot-picker">
              <legend>Choose your character</legend>
              {lobby.status === "connecting" || lobby.status === "idle" ? (
                <p className="hint">Loading characters…</p>
              ) : null}
              {lobby.error ? <p className="join-error">{lobby.error}</p> : null}
              {lobby.status === "ready" && lobby.state?.playerSlots.length === 0 ? (
                <p className="hint">No player slots yet. Ask the DM to create characters in Party.</p>
              ) : null}
              {lobby.status === "ready" && lobby.state && lobby.state.playerSlots.length > 0 ? (
                <div className="slot-list">
                  {lobby.state.playerSlots.map((slot) => {
                    const taken = lobby.state?.connectedPlayers.some(
                      (player) => player.playerId === slot.id,
                    );
                    return (
                      <label
                        key={slot.id}
                        className={`slot-option${taken ? " taken" : ""}`}
                      >
                        <input
                          type="radio"
                          name="slot"
                          value={slot.id}
                          disabled={taken}
                          checked={selectedSlotId === slot.id}
                          onChange={() => setSelectedSlotId(slot.id)}
                        />
                        <span className="slot-name">{slot.name}</span>
                        <span className="slot-status">{taken ? "Taken" : "Available"}</span>
                      </label>
                    );
                  })}
                </div>
              ) : null}
              {selectedSlot ? (
                <p className="hint">Joining as {selectedSlot.name}</p>
              ) : null}
            </fieldset>
          )}

          <button
            type="submit"
            disabled={role === "player" && (!selectedSlotId || lobby.status !== "ready")}
          >
            Enter room
          </button>
        </form>
        <p className="hint">
          Share this link with your party. Add <code>?role=dm</code> for the DM link.
        </p>
      </div>
    </div>
  );
}
