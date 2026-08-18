import { useEffect, useRef, useState } from "react";
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

  // Attached directly to whichever element (placeholder or <img>) is
  // currently rendered — see the render section below. Using the real
  // rendered element as the IntersectionObserver target (instead of an
  // extra wrapper <div>) means no additional DOM node is introduced, so
  // layout/sizing/flex behavior (shrink-0, dimensions, etc.) is unchanged.
  const containerRef = useRef(null);

  const memberId = member?.id;

  const sizeCls =
    size === "modal"
      ? "w-20 h-20 text-base"
      : "w-16 h-16 text-sm";

  useEffect(() => {
    let cancelled = false;
    let observer = null;

    // True once we've actually decided to load this member's photo (either
    // because it scrolled into view, or because IntersectionObserver isn't
    // available and we fell back to loading immediately). Guards against
    // triggering more than one getMemberPhoto() call for the same mount.
    let hasEnteredViewport = false;

    setImgError(false);
    setImageSrc(null);

    if (!memberId) {
      return () => {
        cancelled = true;
      };
    }

    // Local device photo is the only source now — no B2/Cloudinary
    // download, so this works with the internet off.
    async function fetchAndSetPhoto() {
      const local = await getMemberPhoto(memberId);
      if (!cancelled) {
        setImageSrc(local);
      }
    }

    function loadOnce() {
      if (hasEnteredViewport) return;
      hasEnteredViewport = true;
      fetchAndSetPhoto();
    }

    const node = containerRef.current;
    const canObserve =
      typeof IntersectionObserver === "function" && node != null;

    if (canObserve) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              loadOnce();
              // Only ever needed once per mount — stop watching as soon as
              // we've triggered the load, per Task requirements.
              observer.disconnect();
              break;
            }
          }
        },
        { rootMargin: "200px" }
      );
      observer.observe(node);
    } else {
      // IntersectionObserver unavailable (or ref not ready) — gracefully
      // fall back to loading normally, same as pre-lazy-load behavior.
      loadOnce();
    }

    // If this member's photo is taken/replaced/deleted while this component
    // is mounted (e.g. from the "Take Photo" button elsewhere), pick it up
    // immediately — but only if we've already loaded this member's photo at
    // least once. A photo that hasn't scrolled into view yet has no stale
    // image to refresh; it will simply load the current photo the first
    // time it does become visible.
    const unsubscribe = onMemberPhotoChange((changedId) => {
      if (cancelled) return;
      if (changedId !== String(memberId)) return;
      if (!hasEnteredViewport) return;
      fetchAndSetPhoto();
    });

    return () => {
      cancelled = true;
      if (observer) observer.disconnect();
      unsubscribe();
    };
  }, [memberId]);

  if (imageSrc && !imgError) {
    return (
      <img
        ref={containerRef}
        src={imageSrc}
        alt={member?.name || "Member photo"}
        onError={() => setImgError(true)}
        className={`${sizeCls} rounded-full object-cover shrink-0 border border-surface-border`}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className={`${sizeCls} rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center shrink-0`}
    >
      <span className="font-bold text-brand-400">
        {initialsOf(member?.name)}
      </span>
    </div>
  );
}
