import { WaveText } from '../components/WaveText';

function Work() {
  return (
    <section>
      <WaveText as="h1" text="work" />
      <WaveText as="p" text="projects will live here." stagger={0.02} delay={0.25} />
    </section>
  );
}

export default Work;
