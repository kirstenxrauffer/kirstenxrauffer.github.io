import { Helmet } from 'react-helmet-async';
import { WaveText } from '../components/WaveText';
import { PRESS_REFERENCES, WORK_MANIFEST } from '../features/work/workManifest';

const GAP = 1.6; // seconds between each line starting

const PERSON_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: 'Kirsten Rauffer',
  jobTitle: 'Full-Stack Engineer',
  url: 'https://kirstenrauffer.com',
  description:
    'Full-stack engineer at the intersection of art and code. Worked at Discord, LinkedIn, Grainger, Ulta, Microsoft, and Roche.',
  knowsAbout: [
    'React',
    'TypeScript',
    'iOS',
    'Swift',
    'Kotlin',
    'Node.js',
    'Full-Stack Development',
    'Design Systems',
    'Accessibility',
  ],
  worksFor: WORK_MANIFEST.map(c => ({
    '@type': 'Organization',
    name: c.label.charAt(0).toUpperCase() + c.label.slice(1),
  })),
  subjectOf: PRESS_REFERENCES.map(ref => ({
    '@type': ref.type,
    headline: ref.headline,
    url: ref.url,
    publisher: { '@type': 'Organization', name: ref.publisher },
  })),
};

function Home() {
  return (
    <section>
      <Helmet>
        <title>Kirsten Rauffer — Full-Stack Engineer</title>
        <meta
          name="description"
          content="Full-stack engineer at the intersection of art and code. Portfolio of work from Discord, LinkedIn, Grainger, Ulta, and more."
        />
        <link rel="canonical" href="https://kirstenrauffer.com/" />
        <meta property="og:url" content="https://kirstenrauffer.com/" />
        <meta property="og:title" content="Kirsten Rauffer — Full-Stack Engineer" />
        <meta
          property="og:description"
          content="Full-stack engineer at the intersection of art and code. Portfolio of work from Discord, LinkedIn, Grainger, Ulta, and more."
        />
        <script type="application/ld+json">{JSON.stringify(PERSON_JSONLD)}</script>
      </Helmet>
      <WaveText as="h1" variant="scatter" text="hi, i'm kirsten." delay={0} />
      <WaveText as="p" variant="drift" text="i'm a full-stack engineer" delay={GAP} />
      <WaveText as="p" variant="drift" text="who loves the intersection" delay={GAP * 2} />
      <WaveText as="p" variant="drift" text="of art and code" delay={GAP * 3} />
    </section>
  );
}

export default Home;
