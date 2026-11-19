-- Already applied on cheetahs-club (lutcbvzunjcosncvdyke).
-- Kept here so a fresh database matches that bucket. Do not treat a
-- re-run as a new change: it sets the same allowed list.
-- JPG logos are stored as image/jpeg. A PDF is converted to PNG in
-- the admin page, so application/pdf is not a bucket type.
update storage.buckets
set allowed_mime_types = array[
  'video/mp4',
  'image/svg+xml',
  'image/png',
  'image/webp',
  'image/jpg',
  'image/jpeg'
]
where id = 'pulseplay-assets';
