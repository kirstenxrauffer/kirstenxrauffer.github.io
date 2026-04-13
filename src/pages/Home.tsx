import { WaveText } from '../components/WaveText';

const GAP = 1.6; // seconds between each line starting

function Home() {
  return (
    <section>
      <WaveText as="h1" variant="scatter" text="hi, i'm kirsten." delay={0} />
      <WaveText as="p" variant="drift" text="i'm a full-stack engineer" delay={GAP} />
      <WaveText as="p" variant="drift" text="who loves the intersection" delay={GAP * 2} />
      <WaveText as="p" variant="drift" text="of art and code" delay={GAP * 3} />
    </section>
  );
}

export default Home;
