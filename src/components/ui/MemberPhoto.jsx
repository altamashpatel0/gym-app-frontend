import { useEffect, useState } from "react";
import {
  getMemberPhoto,
  onMemberPhotoChange,
} from "../../utils/memberPhotoStorage";

function initialsOf(name) {
  return name
    ? name
        .split(" ")
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";
}

export function MemberPhoto({ member, size = "card" }) {
  const [imageSrc, setImageSrc] = useState(null);
  const [imgError, setImgError] = useState(false);

  const memberId = member?.id;

  const sizeCls =
    size === "modal"
      ? "w-20 h-20 text-base"
      : "w-16 h-16 text-sm";

  useEffect(() => {
    let cancelled = false;

    async function loadPhoto() {
      setImgError(false);

      if (!memberId) {
        setImageSrc(null);
        return;
      }

      // Local device photo is the only source now — no B2/Cloudinary
      // download, so this works with the internet off.
      const local = await getMemberPhoto(memberId);

      if (!cancelled) {
        setImageSrc(local);
      }
    }

    loadPhoto();

    // If this member's photo is taken/replaced/deleted while this component
    // is mounted (e.g. from the "Take Photo" button elsewhere), pick it up
    // immediately instead of showing a stale image.
    const unsubscribe = onMemberPhotoChange((changedId) => {
      if (!cancelled && changedId === String(memberId)) {
        loadPhoto();
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [memberId]);

  if (imageSrc && !imgError) {
    return (
      <img
        src={imageSrc}
        alt={member?.name || "Member photo"}
        onError={() => setImgError(true)}
        className={`${sizeCls} rounded-full object-cover shrink-0 border border-surface-border`}
      />
    );
  }

  return (
    <div
      className={`${sizeCls} rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center shrink-0`}
    >
      <span className="font-bold text-brand-400">
        {initialsOf(member?.name)}
      </span>
    </div>
  );
}
