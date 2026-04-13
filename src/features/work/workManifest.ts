// ── Work asset manifest ───────────────────────────────────────────────────────
// Assets live in assets/ (publicDir), served at the root.
// e.g. assets/work/discord/super-reactions/foo.png → /work/discord/super-reactions/foo.png
//
// To add a company or project: add an entry here. No other changes needed.
// The first asset in each project's `assets` array is used as the top-carousel
// representative thumbnail; order them with the best visual first.
// Exclude txt files — YouTube embeds etc. are not listed here.

export interface ProjectAssets {
  slug: string;
  label: string;
  assets: string[];   // public-relative URLs or absolute CDN URLs
  description?: string;
  skills?: string[];
  leadership?: string[];
}

export interface CompanyWork {
  slug: string;
  label: string;
  color: string;
  projects: ProjectAssets[];
}

export const WORK_MANIFEST: CompanyWork[] = [
  {
    slug: 'discord',
    label: 'discord',
    color: '#5865F2',
    projects: [
      {
        slug: 'super-reactions',
        label: 'super reactions',
        description: 'Nitro feature that fires an animated burst effect when reacting to a message, visible to everyone in the chat. Animations were built with Lottie; we extracted the top colors from each emoji and piped them directly into the animation so a fire emoji bursts in orange, a purple heart ripples in violet, and so on, making each animation unique. Official demo: <a href="https://youtube.com/watch?v=IIRLMV9SZds" target="_blank" rel="noopener noreferrer">youtube.com/watch?v=IIRLMV9SZds</a> · <a href="https://discord.com/blog/super-reactions-make-emoji-burst-to-life-discord-nitro" target="_blank" rel="noopener noreferrer">discord.com/blog/super-reactions-make-emoji-burst-to-life-discord-nitro</a>',
        skills: ['React', 'TypeScript', 'Lottie', 'Animation'],
        assets: [
          '/work/discord/super-reactions/official-demo.gif',
          '/work/discord/super-reactions/reactions-burst.gif',
          '/work/discord/super-reactions/blog-header.png',
          '/work/discord/super-reactions/ui-toggle.png',
          '/work/discord/super-reactions/updated-view-reactions-window.png',
        ],
      },
      {
        slug: 'voice-channel-reactions',
        label: 'voice channel reactions',
        description: 'Real-time emoji reactions for voice and video calls. Tap an emoji and it animates across the call interface without unmuting. Nitro subscribers get animated cross-server emoji and full-screen scroll effects. Animations were built with Lottie, with the top colors extracted from each emoji and injected at runtime, keeping each animation fresh. Led the mobile implementation; primary developer on desktop. Covered by Adweek: <a href="https://adweek.com/media/discord-how-to-use-voice-channel-reactions-on-desktop/" target="_blank" rel="noopener noreferrer">adweek.com/media/discord-how-to-use-voice-channel-reactions-on-desktop/</a>',
        skills: ['React', 'TypeScript', 'Lottie', 'Real-time', 'Mobile'],
        assets: [
          '/work/discord/voice-channel-reactions/voice-channel-reactions.gif',
          '/work/discord/voice-channel-reactions/hero.png',
        ],
      },
      {
        slug: 'entrance-sounds',
        label: 'entrance sounds',
        description: 'Nitro perk that auto-plays a Soundboard clip when you join a voice channel. The emoji infrastructure from Voice Channel Reactions was seamlessly extended: users pair an emoji with each entrance sound, and the emoji animates across the channel screen the moment they walk in. Primary developer end-to-end. <a href="https://discord.com/blog/how-to-use-the-discord-soundboard-add-more-sounds" target="_blank" rel="noopener noreferrer">discord.com/blog/how-to-use-the-discord-soundboard-add-more-sounds</a>',
        skills: ['React', 'TypeScript', 'Lottie', 'Mobile', 'Audio UI'],
        assets: [
          '/work/discord/entrance-sounds/entrance-sounds-tiktok.gif',
          '/work/discord/entrance-sounds/custom-sounds-anywhere.gif',
          '/work/discord/entrance-sounds/custom-sounds-anywhere-promo.png',
        ],
      },
      {
        slug: 'custom-app-icons',
        label: 'custom app icons (mobile)',
        description: 'Nitro feature letting subscribers swap the Discord home screen icon from a curated library, including seasonal drops like Halloween (Avatar → User Settings → App Settings → App Icon). Launched September 2023 with ~20 icons. Advocated internally for users to keep their chosen icon even after Nitro expires, confirmed working in the wild: <a href="https://reddit.com/r/discordapp/comments/1kmcpdk/" target="_blank" rel="noopener noreferrer">reddit.com/r/discordapp/comments/1kmcpdk/</a>. Intentionally built easter eggs to drive organic engagement and discovery: the Pirate icon randomizes its display name on every tap, and a hidden interaction on the settings page has yet to be publicly discovered.',
        skills: ['React Native', 'iOS', 'TypeScript', 'UX Design'],
        leadership: ['Cross-functional advocacy'],
        assets: [
          '/work/discord/custom-app-icons/icon-options-preview.jpg',
          '/work/discord/custom-app-icons/new-icon-packs-preview.png',
          '/work/discord/custom-app-icons/custom_app_icon_home_screen.png',
          '/work/discord/custom-app-icons/custom_app_icon_selection.png',
          '/work/discord/custom-app-icons/custom_app_icon_settings.png',
        ],
      },
      {
        slug: 'custom-desktop-icons',
        label: 'custom desktop icons',
        description: 'Desktop-side implementation of Discord\'s custom app icon Nitro perk (User Settings → Appearance → App Icon). Pitched directly to head of product while the team was down a PM and designer. Owned the full feature end-to-end: designed the settings UI, UX, and marketing; adapted mobile icon assets for desktop without support from the core art team; shipped in a single sprint. Advocated for users to keep their chosen icon after Nitro expires, confirmed in the wild: <a href="https://reddit.com/r/discordapp/comments/1kmcpdk/" target="_blank" rel="noopener noreferrer">reddit.com/r/discordapp/comments/1kmcpdk/</a>',
        skills: ['React', 'Electron', 'TypeScript', 'UX Design'],
        leadership: ['Pitched to Head of Product', 'End-to-end ownership'],
        assets: [
          '/work/discord/custom-desktop-icons/blurple-twilight-desktop.png',
          '/work/discord/custom-desktop-icons/icon-options-preview.jpg',
          '/work/discord/custom-desktop-icons/new-icon-packs-preview.png',
          '/work/discord/custom-desktop-icons/ezgif-2-3bf8156bec.gif',
          '/work/discord/custom-desktop-icons/867577c9-651c-4de0-b7b5-202456f5f4db.png',
          '/work/discord/custom-desktop-icons/a47c3ad0-848b-4d68-b2a0-d21fa66ee248.png',
          '/work/discord/custom-desktop-icons/e8df9be9-6fd6-4c02-ab7b-ef0b5cf92f9a.png',
        ],
      },
      {
        slug: '500mb-uploads',
        label: '500mb uploads',
        description: 'My first project at Discord. Nitro subscribers were capped at 100MB uploads, so I migrated file storage from Discord\'s own infrastructure to Google Cloud Storage to push that to 500MB. Free users stay at 10MB; Nitro subscribers now get 50x that, enabling large video recordings, high-res assets, and game captures shared directly in chat.',
        skills: ['Node.js', 'GCS', 'Back-end', 'Infrastructure'],
        assets: [
          '/work/discord/500mb-uploads/new.png',
          '/work/discord/500mb-uploads/old-womp.png',
        ],
      },
    ],
  },
  {
    slug: 'grainger',
    label: 'grainger',
    color: '#CC0000',
    projects: [
      {
        slug: 'digital-asset-management',
        label: 'rich content',
        description: 'Full-stack engineer on the rich content team, supporting Grainger\'s millions of products and all their supporting materials, both static and dynamic: product images, compliance documents like Energy Guides, 2D and 3D CAD files, videos, copy, and more. Sole engineer to decouple the codebase from a massive monorepo, establishing the migration pattern to be adopted by future teams decoupling. Currently improving search and upload UX across all asset types, and building an ML classification pipeline using AWS tooling. The internal system is proprietary.',
        skills: ['Full-stack', 'React', 'TypeScript', 'DAM'],
        assets: [
          '/work/grainger/digital-asset-management/cad.gif',
          '/work/grainger/digital-asset-management/lf.gif',
        ],
      },
    ],
  },
  {
    slug: 'ulta',
    label: 'ulta',
    color: '#E50695',
    projects: [
      {
        slug: 'homepage',
        label: '2.0 card components',
        description: 'Developed the new 2.0 card components used across the site (homepage and beyond) for mobile and desktop web. Worked closely with accessibility, design, PM, and engineering partners across both product teams and the horizontal design system team. Also delivered the 2.0 bubble navigation.',
        skills: ['React', 'TypeScript', 'CSS', 'Accessibility', 'Design Systems'],
        leadership: ['Cross-team coordination'],
        assets: [
          '/work/ulta/homepage/hero-card.gif',
          '/work/ulta/homepage/product-card.gif',
        ],
      },
      {
        slug: 'pdp',
        label: 'product detail page',
        description: 'Built the Frequently Bought Together feature on the PDP, which laid the groundwork for future teams to build Make It A Routine. Also developed the 2.0 delivery switcher component.',
        skills: ['React', 'TypeScript', 'CSS'],
        assets: [
          '/work/ulta/pdp/frequently-bought-together.gif',
          '/work/ulta/pdp/delivery-picker.gif',
        ],
      },
    ],
  },
  {
    slug: 'linkedin',
    label: 'linkedin',
    color: '#0077B5',
    projects: [
      {
        slug: 'document-viewer',
        label: 'document viewer',
        description: 'Built two document viewers for LinkedIn: one for the Feed, where uploading a PDF, PPT, or Word file lets followers swipe through pages without leaving LinkedIn (drives 3× more clicks than any other post type); and one for LinkedIn Learning, enabling enterprises to upload custom documents for their employees to view. Built framework-agnostic in vanilla JS (~50 people across 15 teams, 6+ months). Led accessibility for the centralized viewer adopted across Feed, Learning, Recruiter, and more: adapted PDF.js to parse tagged PDFs as semantic HTML so screen readers navigate documents structurally rather than hitting a wall of text. Co-authored the LinkedIn Engineering blog post on the architecture. Nominated for LinkedIn\'s Engineering Award for Craftsmanship, one of 4 nominees out of 4,000+ engineers. <a href="https://linkedin.com/blog/engineering/learning/under-the-hood-learning-with-documents" target="_blank" rel="noopener noreferrer">linkedin.com/blog/engineering/learning/under-the-hood-learning-with-documents</a>',
        skills: ['React', 'TypeScript', 'Accessibility', 'Java', 'Performance'],
        leadership: ['Engineering Award nominee', 'Co-authored eng blog post', 'Cross-org a11y lead'],
        assets: [
          '/work/linkedin/document-viewer/1700688379926.png',
          '/work/linkedin/document-viewer/1700688379965.png',
          '/work/linkedin/document-viewer/1700688380360.png',
          '/work/linkedin/document-viewer/1700688381379.png',
        ],
      },
      {
        slug: 'skills-path',
        label: 'skills path',
        description: 'Skills-based hiring pipeline on LinkedIn that pairs curated Learning courses with Skill Assessments. Candidates who pass are guaranteed a recruiter interview, removing degree/credential gatekeeping. Piloted with Gap Inc., BlackRock, Citrix, Gusto, and others in 2021. Served as team lead while simultaneously leading UI for the Skill Assessments team. "Helps us connect with candidates faster based on core skills and potential rather than traditional experience or credentials." — Meghan Kelly, Global Head of Talent Acquisition, Gap Inc. Press: <a href="https://shrm.org" target="_blank" rel="noopener noreferrer">SHRM</a>, <a href="https://gapinc.com" target="_blank" rel="noopener noreferrer">Gap Inc. press release</a>, <a href="https://linkedin.com/business/talent/blog/product-tips/introducing-skills-path" target="_blank" rel="noopener noreferrer">LinkedIn blog</a>.',
        skills: ['React', 'TypeScript', 'Full-stack', 'Java'],
        assets: [
          '/work/linkedin/skills-path/1618352849053.jpeg',
          '/work/linkedin/skills-path/1618352850150.gif',
          '/work/linkedin/skills-path/1618352867835.gif',
        ],
      },
      {
        slug: 'learning',
        label: 'enterprise content',
        description: 'Led projects giving enterprise admins the ability to upload their own content to LinkedIn Learning: documents, videos, learning paths, and collections. Personally drove the collaboration between LinkedIn Learning\'s consumer and enterprise surfaces — I was the connective tissue across those teams, unifying shared components like cards through both process and code so both products stayed in sync. Earned Hackday Master by winning 5 global LinkedIn hackathons, one of which resulted in a US patent.',
        skills: ['React', 'TypeScript', 'Java', 'Admin tooling'],
        leadership: ['5× Hackday Champion', 'US Patent holder'],
        assets: [
          '/work/linkedin/learning/learning.gif',
          '/work/linkedin/learning/admin.gif',
        ],
      },
    ],
  },
  {
    slug: 'microsoft',
    label: 'microsoft',
    color: '#00BCF2',
    projects: [
      {
        slug: 'dynamics365',
        label: 'dynamics 365',
        description: 'Worked on a Dynamics 365 implementation building out flows across vendors, voyages, inventory, and more. Based in København, Denmark, I collaborated with globally distributed sister teams in Seattle and the Midwest. As the office began venturing into custom SPAs, I taught web development internally, including consolidated, plug-and-play vendor portals built in C++ and AngularJS.',
        skills: ['Dynamics 365', 'C++', 'AngularJS', 'ERP'],
        leadership: ['Internal engineering trainer'],
        assets: [
          '/work/microsoft/dynamics365/dynamics365-screenshot.png',
        ],
      },
    ],
  },
  {
    slug: 'roche',
    label: 'roche',
    color: '#0065BD',
    projects: [
      {
        slug: 'neptun',
        label: 'neptun',
        description: 'iOS diabetes management app built for Roche, now operated by Linova. Logs blood glucose, insulin, and nutrition, with Bluetooth sync to Accu-Chek meters, Apple Watch support, and a rule-based coaching engine. Started as a proof-of-concept through TU Munich (Praktikum) and still ships today in its original form, including the original charts and icons. Designed the entire UI and all iconography, built the interface from scratch in Swift, and assisted with the Bluetooth LE integration for syncing patient data from Accu-Chek glucose monitors.',
        skills: ['Swift', 'iOS', 'BLE', 'HealthKit', 'Apple Watch'],
        assets: [
          '/work/roche/neptun/overview.png',
          '/work/roche/neptun/phone-mockup.webp',
          '/work/roche/neptun/coaching.webp',
          '/work/roche/neptun/diary.webp',
          '/work/roche/neptun/devices.webp',
          '/work/roche/neptun/app-icon.png',
        ],
      },
    ],
  },
];
