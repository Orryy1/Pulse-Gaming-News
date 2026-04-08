/*
  Blog Templates - HTML template literal functions
  Dark theme matching brand palette. No external CSS/JS frameworks.
*/

const brand = require('../brand');

const ACCENT = brand.PRIMARY || '#FF6B1A';
const BG = brand.SECONDARY || '#0D0D0F';
const TEXT = brand.TEXT || '#F0F0F0';

/**
 * Full HTML page for an individual blog post.
 * @param {object} data - { title, slug, description, html, publishedAt, seoKeywords, story }
 */
function postTemplate(data) {
  const { title, slug, description, html, publishedAt, seoKeywords, story, storyImageSlug } = data;
  // Prefer the locally copied story card image for og:image if available
  const ogImage = storyImageSlug
    ? `/blog/images/${storyImageSlug}.png`
    : ((story && story.article_image) || '');
  const youtubeUrl = (story && story.youtube_url) || '';
  const affiliateUrl = (story && story.affiliate_url) || '';
  const channelName = brand.CHANNEL_NAME || 'Pulse Gaming';
  const baseUrl = process.env.RAILWAY_PUBLIC_URL || 'http://localhost:3001';
  const flair = (story && (story.classification || story.flair)) || '';

  const youtubeEmbed = youtubeUrl
    ? (() => {
        // Extract video ID from various YouTube URL formats
        const match = youtubeUrl.match(/(?:v=|shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        const videoId = match ? match[1] : '';
        if (!videoId) return '';
        return `<div class="yt-embed"><iframe width="315" height="560" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
      })()
    : '';

  const affiliateCta = affiliateUrl
    ? `<a href="${affiliateUrl}" class="cta-btn" target="_blank" rel="noopener noreferrer sponsored">Check it out on Amazon</a>`
    : '';

  // Build enhanced Schema.org JSON-LD for NewsArticle
  const jsonLdObj = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${baseUrl}/blog/${slug}.html`,
    },
    headline: title,
    description: description,
    datePublished: publishedAt,
    dateModified: publishedAt,
    author: { '@type': 'Organization', name: channelName, url: baseUrl },
    publisher: {
      '@type': 'Organization',
      name: channelName,
      url: baseUrl,
      logo: {
        '@type': 'ImageObject',
        url: `${baseUrl}/branding/logo.png`,
      },
    },
  };

  if (ogImage) {
    jsonLdObj.image = {
      '@type': 'ImageObject',
      url: ogImage,
    };
  }

  if (flair) {
    jsonLdObj.articleSection = flair;
  }

  if (seoKeywords) {
    jsonLdObj.keywords = seoKeywords;
  }

  if (youtubeUrl) {
    const vidMatch = youtubeUrl.match(/(?:v=|shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    const vidId = vidMatch ? vidMatch[1] : '';
    if (vidId) {
      jsonLdObj.video = {
        '@type': 'VideoObject',
        name: title,
        description: description,
        thumbnailUrl: `https://img.youtube.com/vi/${vidId}/maxresdefault.jpg`,
        embedUrl: `https://www.youtube.com/embed/${vidId}`,
        uploadDate: publishedAt,
      };
    }
  }

  const jsonLd = JSON.stringify(jsonLdObj);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)} | ${escHtml(channelName)}</title>
<meta name="description" content="${escAttr(description)}">
<link rel="alternate" type="application/rss+xml" title="${escAttr(channelName)} RSS Feed" href="${escAttr(baseUrl)}/blog/rss.xml">
<meta property="og:title" content="${escAttr(title)}">
<meta property="og:description" content="${escAttr(description)}">
${ogImage ? `<meta property="og:image" content="${escAttr(ogImage)}">` : ''}
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(title)}">
<meta name="twitter:description" content="${escAttr(description)}">
${ogImage ? `<meta name="twitter:image" content="${escAttr(ogImage)}">` : ''}
<script type="application/ld+json">${jsonLd}</script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:${BG};color:${TEXT};font-family:'Inter','Segoe UI',sans-serif;line-height:1.7;padding:0 16px}
a{color:${ACCENT};text-decoration:none}
a:hover{text-decoration:underline}
.container{max-width:720px;margin:0 auto;padding:40px 0}
nav{padding:16px 0;border-bottom:1px solid #222}
nav a{font-size:14px;opacity:0.7}
nav a:hover{opacity:1}
h1{font-size:28px;line-height:1.3;margin:32px 0 12px;color:${TEXT}}
.meta{font-size:13px;color:#888;margin-bottom:24px}
article{font-size:16px;line-height:1.8}
article p{margin-bottom:16px}
article h2{font-size:20px;margin:28px 0 12px;color:${ACCENT}}
.yt-embed{margin:24px 0;text-align:center}
.yt-embed iframe{max-width:100%;border-radius:8px}
.cta-btn{display:inline-block;margin:24px 0;padding:12px 28px;background:${ACCENT};color:#000;font-weight:700;border-radius:6px;font-size:15px}
.cta-btn:hover{text-decoration:none;opacity:0.9}
footer{margin-top:48px;padding:24px 0;border-top:1px solid #222;font-size:13px;color:#555;text-align:center}
</style>
<!-- AdSense slot -->
</head>
<body>
<div class="container">
<nav><a href="/blog/">&larr; Back to ${escHtml(channelName)}</a></nav>
<h1>${escHtml(title)}</h1>
<div class="meta">Published ${new Date(publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
${youtubeEmbed}
<article>${html}</article>
${affiliateCta}
<footer>&copy; ${new Date().getFullYear()} ${escHtml(channelName)}. All rights reserved.</footer>
</div>
</body>
</html>`;
}

/**
 * Paginated index page listing all blog posts.
 * @param {Array} posts - array of { title, slug, description, publishedAt, story }
 * @param {number} page - current page (1-based)
 * @param {number} totalPages
 */
function indexTemplate(posts, page, totalPages) {
  const channelName = brand.CHANNEL_NAME || 'Pulse Gaming';
  const tagline = brand.TAGLINE || '';

  const postItems = posts.map(p => {
    const dateStr = new Date(p.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const ogImage = (p.story && p.story.article_image) || '';
    const imgTag = ogImage
      ? `<img src="${escAttr(ogImage)}" alt="" loading="lazy" style="width:100%;height:180px;object-fit:cover;border-radius:6px;margin-bottom:12px">`
      : '';
    return `<div class="post-card">
${imgTag}
<h2><a href="/blog/${p.slug}.html">${escHtml(p.title)}</a></h2>
<div class="post-meta">${dateStr}</div>
<p>${escHtml(p.description)}</p>
</div>`;
  }).join('\n');

  let pagination = '';
  if (totalPages > 1) {
    const links = [];
    if (page > 1) links.push(`<a href="/blog/${page === 2 ? 'index' : 'page-' + (page - 1)}.html">&larr; Newer</a>`);
    links.push(`<span>Page ${page} of ${totalPages}</span>`);
    if (page < totalPages) links.push(`<a href="/blog/page-${page + 1}.html">Older &rarr;</a>`);
    pagination = `<div class="pagination">${links.join(' ')}</div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(channelName)} | Gaming News Blog</title>
<meta name="description" content="${escAttr(tagline)}">
<link rel="alternate" type="application/rss+xml" title="${escAttr(channelName)} RSS Feed" href="/blog/rss.xml">
<meta property="og:title" content="${escAttr(channelName)} | Gaming News Blog">
<meta property="og:description" content="${escAttr(tagline)}">
<meta property="og:image" content="/branding/og_image.png">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="/branding/og_image.png">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:${BG};color:${TEXT};font-family:'Inter','Segoe UI',sans-serif;line-height:1.6;padding:0 16px}
a{color:${ACCENT};text-decoration:none}
a:hover{text-decoration:underline}
.container{max-width:800px;margin:0 auto;padding:40px 0}
header{text-align:center;margin-bottom:40px}
header h1{font-size:32px;color:${ACCENT}}
header p{color:#888;margin-top:8px}
.post-card{background:#15151a;border:1px solid #222;border-radius:8px;padding:20px;margin-bottom:20px}
.post-card h2{font-size:18px;margin-bottom:6px}
.post-card .post-meta{font-size:12px;color:#666;margin-bottom:8px}
.post-card p{font-size:14px;color:#aaa}
.pagination{display:flex;justify-content:center;align-items:center;gap:16px;margin-top:32px;font-size:14px}
.pagination span{color:#666}
footer{margin-top:48px;padding:24px 0;border-top:1px solid #222;font-size:13px;color:#555;text-align:center}
</style>
<!-- AdSense slot -->
</head>
<body>
<div class="container">
<header>
<h1>${escHtml(channelName)}</h1>
<p>${escHtml(tagline)}</p>
</header>
${postItems}
${pagination}
<footer>&copy; ${new Date().getFullYear()} ${escHtml(channelName)}. All rights reserved.</footer>
</div>
</body>
</html>`;
}

/**
 * Standard XML sitemap.
 * @param {Array} posts - array of { slug, publishedAt }
 * @param {string} baseUrl
 */
function sitemapTemplate(posts, baseUrl) {
  const urls = posts.map(p =>
    `  <url>\n    <loc>${escXml(baseUrl)}/blog/${p.slug}.html</loc>\n    <lastmod>${p.publishedAt.slice(0, 10)}</lastmod>\n  </url>`
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${escXml(baseUrl)}/blog/</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
  </url>
${urls}
</urlset>`;
}

/**
 * RSS 2.0 feed.
 * @param {Array} posts - array of { title, slug, description, publishedAt }
 * @param {string} baseUrl
 * @param {string} channelName
 */
function rssTemplate(posts, baseUrl, channelName) {
  const items = posts.map(p => {
    const articleHtml = p.html || p.description || '';
    return `    <item>
      <title>${escXml(p.title)}</title>
      <link>${escXml(baseUrl)}/blog/${p.slug}.html</link>
      <description>${escXml(p.description)}</description>
      <content:encoded><![CDATA[${articleHtml}]]></content:encoded>
      <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>
      <guid isPermaLink="true">${escXml(baseUrl)}/blog/${p.slug}.html</guid>${p.storyImageSlug ? `
      <enclosure url="${escXml(baseUrl)}/blog/images/${p.storyImageSlug}.png" type="image/png"/>` : ''}
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escXml(channelName)}</title>
    <link>${escXml(baseUrl)}/blog/</link>
    <description>Gaming news, leaks and rumours from ${escXml(channelName)}</description>
    <language>en-gb</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escXml(baseUrl)}/blog/rss.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;
}

// --- Utility helpers ---

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return escHtml(str);
}

function escXml(str) {
  return escHtml(str).replace(/'/g, '&apos;');
}

module.exports = {
  postTemplate,
  indexTemplate,
  sitemapTemplate,
  rssTemplate,
};
