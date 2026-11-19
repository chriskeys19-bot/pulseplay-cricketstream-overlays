/*
 * Which store the pages talk to.
 * Leave adapter as "mock" until Ben has applied supabase/migrations
 * and the pulseplay-assets bucket exists. Then set adapter to "supabase".
 * The publishable key is public client config, not a secret.
 */
window.PulsePlayRuntime = {
  adapter: "mock",
  supabaseUrl: "https://lutcbvzunjcosncvdyke.supabase.co",
  supabaseKey: "sb_publishable__9ccTY7CvOMP4vtQ13ccWQ_Lar1zavn",
  pollMs: 2000
};
