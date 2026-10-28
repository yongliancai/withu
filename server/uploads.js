// 上傳檔案檢查：看檔案開頭的「魔術數字」確認真的是圖片／聲音，不只相信副檔名或瀏覽器說的類型。
const starts = (b, bytes, at = 0) => bytes.every((x, i) => b[at + i] === x);

export function looksLikeImage(buf) {
  if (!buf || buf.length < 12) return false;
  return starts(buf, [0xFF, 0xD8, 0xFF])                                   // JPEG
    || starts(buf, [0x89, 0x50, 0x4E, 0x47])                                // PNG
    || (starts(buf, [0x52, 0x49, 0x46, 0x46]) && starts(buf, [0x57, 0x45, 0x42, 0x50], 8)) // WEBP
    || starts(buf, [0x47, 0x49, 0x46, 0x38])                                // GIF
    || (starts(buf, [0x66, 0x74, 0x79, 0x70], 4) && /^(heic|heix|mif1|msf1|avif)/.test(buf.slice(8, 12).toString())); // HEIC/AVIF
}

export function looksLikeAudio(buf) {
  if (!buf || buf.length < 12) return false;
  return starts(buf, [0x1A, 0x45, 0xDF, 0xA3])           // WebM / Matroska
    || starts(buf, [0x66, 0x74, 0x79, 0x70], 4)           // MP4 / M4A
    || starts(buf, [0x4F, 0x67, 0x67, 0x53])              // OGG
    || starts(buf, [0x49, 0x44, 0x33]) || (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) // MP3
    || (starts(buf, [0x52, 0x49, 0x46, 0x46]) && starts(buf, [0x57, 0x41, 0x56, 0x45], 8)); // WAV
}
