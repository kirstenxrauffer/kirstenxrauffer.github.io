import { WaveText } from '../components/WaveText';

function Home() {
  return (
    <section>
      <WaveText as="h1" text="hi, i'm kirsten." />
      <WaveText
        as="p"
        text="i'm a full-stack engineer"
        stagger={0.02}
        delay={0.3}
      />
    </section>
  );
}

export default Home;
