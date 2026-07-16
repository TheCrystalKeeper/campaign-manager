import {
  readRegistryFromR2,
  upsertRegistryRoomInR2,
} from "../_shared/campaignRegistryStorage";

/// <summary>
/// Returns the shared campaign room list for the join screen.
/// </summary>
export const onRequestGet: PagesFunction = async (context) => {
  if (!context.env.UPLOADS) {
    return new Response(
      JSON.stringify({
        error: "Campaign registry is not configured. Bind an R2 bucket named UPLOADS.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const rooms = await readRegistryFromR2(context.env.UPLOADS);
    return new Response(JSON.stringify({ rooms }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Could not load campaign rooms.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};

/// <summary>
/// Registers a campaign room so other players can discover it on the join screen.
/// </summary>
export const onRequestPost: PagesFunction = async (context) => {
  if (!context.env.UPLOADS) {
    return new Response(
      JSON.stringify({
        error: "Campaign registry is not configured. Bind an R2 bucket named UPLOADS.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const body = (await context.request.json()) as {
      roomId?: string;
      name?: string;
      iconUrl?: string | null;
      description?: string | null;
    };
    const roomId = body.roomId?.trim();
    const name = body.name?.trim();
    if (!roomId || !name) {
      return new Response(JSON.stringify({ error: "roomId and name are required." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const rooms = await upsertRegistryRoomInR2(context.env.UPLOADS, {
      roomId,
      name,
      iconUrl: body.iconUrl ?? null,
      description: body.description ?? null,
    });
    return new Response(JSON.stringify({ rooms }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Could not register campaign room.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
