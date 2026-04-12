import { WaveText } from '../components/WaveText';

function About() {
  return (
    <section>
      <WaveText as="h1" text="about" />
      <WaveText as="p" text="bio goes here." stagger={0.02} delay={0.25} />
    </section>
  );
}

export default About;
