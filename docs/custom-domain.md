# Attach a custom domain (manual steps)

Space Apps participants get a free domain through GoDaddy. To point it at the Vercel site:

1. **Vercel:** open the `site-comparer-thing` project → **Settings → Domains** → **Add**. Enter the domain (e.g. `analogfinder.space`) and also add `www.<domain>` when Vercel offers it, set to redirect to the apex.
2. Vercel shows the DNS records it needs. Usually that's an **A record** for the apex (`@`) pointing to Vercel's IP (`76.76.21.21` at the time of writing; use whatever Vercel displays) and a **CNAME** for `www` pointing to `cname.vercel-dns.com`.
3. **GoDaddy:** **My Products → Domains → DNS → Manage DNS**. Delete any existing `@` A record and `www` CNAME that point elsewhere (GoDaddy parking), then add the two records from step 2. Leave the TTL at the default.
4. Back in Vercel, wait until the domain shows **Valid Configuration**. This takes from a few minutes to a few hours. Vercel issues the HTTPS certificate automatically.
5. Update the links. `index.html` `og:url`/`og:image`, the README "Live demo" line and `docs/submission.md` all say `site-comparer-thing.vercel.app`. The old URL keeps working, so this is optional, but the submission should use whichever URL you test last.

Alternative: in GoDaddy, change the nameservers to `ns1.vercel-dns.com` / `ns2.vercel-dns.com` and let Vercel manage DNS. That's simpler, but it moves all DNS for the domain (including any email records) to Vercel.
