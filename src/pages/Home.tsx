import { WaveText } from '../components/WaveText';

function Home() {
  return (
    <section>
      <WaveText as="h1" text="hi, i'm kirsten." />
      <WaveText
        as="p"
        text="I'm an engineer"
        stagger={0.02}
        delay={0.3}
      />
    </section>
  );
}

export default Home;
