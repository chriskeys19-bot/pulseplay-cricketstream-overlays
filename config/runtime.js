/*
 * Which store the pages talk to.
 * adapter "supabase" is the live default now that the pp_ migration
 * has been applied on cheetahs-club. Add ?adapter=mock to any page URL
 * to use the local example config instead (localStorage + IndexedDB).
 * The publishable key is public client config, not a secret.
 */
window.PulsePlayRuntime = {
  adapter: "supabase",
  supabaseUrl: "https://lutcbvzunjcosncvdyke.supabase.co",
  supabaseKey: "sb_publishable__9ccTY7CvOMP4vtQ13ccWQ_Lar1zavn",
  pollMs: 2000
};
