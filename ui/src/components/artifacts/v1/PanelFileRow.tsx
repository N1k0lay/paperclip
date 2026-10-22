import { Download, ExternalLink } from "lucide-react";
import { useContext, useState, type ReactNode } from "react";
import { IssueGalleryContext } from "@/context/IssueGalleryContext";
import { TextAttachmentContext } from "@/context/TextAttachmentContext";
import { ImageGalleryModal } from "@/components/ImageGalleryModal";
import { isTextAttachment } from "@/lib/issue-attachments";
import { isImageLikeOutput, isVideoLikeOutput } from "@/lib/issue-output";
import { ArtifactRow } from "./ArtifactRow";
import type { ArtifactSubject } from "./kinds";

/** A small control beside a row, as the shipped rows draw theirs. */
export const ROW_ACTION_CLASS = "shrink-0 rounded-md px-1.5 py-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

/**
 * A file in the panel's Artifacts tab (an attachment or an attachment-backed
 * work product) as a V1 row, opening the way the shipped card does: pictures
 * and video in the task's gallery (or a gallery of their own), text in a
 * text tab when the panel offers one, anything else in a new tab. Open raw
 * and download stay beside the name.
 */
export function PanelFileRow({
  subject,
  id,
  attachmentId,
  filename,
  contentType,
  contentPath,
  openPath,
  downloadPath,
  statusBadge,
  now,
}: {
  subject: ArtifactSubject;
  id: string;
  attachmentId?: string;
  filename: string;
  contentType: string;
  contentPath: string;
  openPath: string;
  downloadPath: string;
  statusBadge?: ReactNode;
  now?: Date;
}) {
  const openGallery = useContext(IssueGalleryContext);
  const openTextAttachment = useContext(TextAttachmentContext);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const picture = Boolean(contentPath) && (isImageLikeOutput(contentType, filename) || isVideoLikeOutput(contentType, filename));
  const textTab = Boolean(openTextAttachment && attachmentId && isTextAttachment({ contentType, originalFilename: filename }));
  const trailing = (
    <>
      {statusBadge}
      {openPath ? (
        <a href={openPath} target="_blank" rel="noreferrer" aria-label={`Open raw ${filename}`} title="Open raw" className={ROW_ACTION_CLASS}>
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      ) : null}
      {downloadPath ? (
        <a href={downloadPath} download={filename} aria-label={`Download ${filename}`} title="Download" className={ROW_ACTION_CLASS}>
          <Download className="h-3 w-3" aria-hidden />
        </a>
      ) : null}
    </>
  );
  if (picture) {
    return (
      <>
        <ArtifactRow subject={subject} onClick={() => { if (!openGallery?.(contentPath)) setGalleryOpen(true); }} trailing={trailing} now={now} />
        {galleryOpen ? (
          <ImageGalleryModal items={[{ id, contentPath, contentType, originalFilename: filename, downloadPath }]} initialIndex={0} open onOpenChange={setGalleryOpen} />
        ) : null}
      </>
    );
  }
  if (textTab) {
    return <ArtifactRow subject={subject} onClick={() => openTextAttachment?.(attachmentId!, filename)} trailing={trailing} now={now} />;
  }
  return <ArtifactRow subject={subject} href={openPath || contentPath} trailing={trailing} now={now} />;
}
