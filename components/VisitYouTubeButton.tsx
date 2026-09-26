'use client';

export function VisitYouTubeButton({
  channelId,
  handle,
  youtubeChannelId,
}: {
  channelId: string;
  handle: string | null;
  youtubeChannelId: string;
}) {
  const url = `https://youtube.com/${handle ?? `channel/${youtubeChannelId}`}`;

  return (
    <a
      className="btn btn-secondary"
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={() => {
        fetch(`/api/channels/${channelId}/click`, { method: 'POST' }).catch(() => {});
      }}
    >
      Visit YouTube
    </a>
  );
}
