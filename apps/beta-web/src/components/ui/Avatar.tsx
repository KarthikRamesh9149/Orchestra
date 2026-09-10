import { createAvatar } from "@dicebear/core";
import { avataaars } from "@dicebear/collection";

const avatarSeedMap: Record<string, string> = {
  SC: "Sarah Chen",
  "Sarah Chen": "Sarah Chen",
  MT: "Marcus Thompson",
  "Marcus T": "Marcus Thompson",
  "Marcus Thompson": "Marcus Thompson",
  PK: "Priya Kumar",
  "Priya K": "Priya Kumar",
  "Priya Kumar": "Priya Kumar",
  JW: "James Wilson",
  "James W": "James Wilson",
  "James Wilson": "James Wilson",
  AP: "Alex Park",
  "Alex P": "Alex Park",
  "Alex Park": "Alex Park",
  LF: "Lisa Foster",
  "Lisa F": "Lisa Foster",
  "Lisa Foster": "Lisa Foster"
};

function resolveAvatarSeed(seed: string) {
  return avatarSeedMap[seed] ?? seed;
}

export default function Avatar({
  seed,
  size = 40,
  name,
  role
}: {
  seed: string;
  size?: number;
  name?: string;
  role?: string;
}) {
  const resolvedSeed = resolveAvatarSeed(seed);
  const avatar = createAvatar(avataaars, {
    seed: resolvedSeed,
    size,
    backgroundColor: ["b6e3f4", "c0aede", "d1d4f9", "ffd5dc", "ffdfbf"],
    backgroundType: ["gradientLinear"]
  });

  const svg = avatar.toString();
  const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  const title = name ? (role ? `${name} · ${role}` : name) : resolvedSeed;

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <img
        src={dataUri}
        width={size}
        height={size}
        style={{
          borderRadius: "50%",
          border: "none",
          boxShadow: "none",
          display: "block"
        }}
        alt={name ?? resolvedSeed}
        title={title}
      />
    </div>
  );
}
