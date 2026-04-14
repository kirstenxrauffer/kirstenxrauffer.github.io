import { WaveText } from '../components/WaveText';
import styles from './About.module.scss';

const GAP = 1.6; // seconds between each line starting

function About() {
  return (
    <section className={styles.section}>
      <WaveText as="h1" variant="scatter" text="kirsten rauffer" delay={0} />
      <WaveText as="p" variant="drift" text="a jersey girl at heart." delay={GAP} />
      <WaveText as="p" variant="drift" text="i love buffalo wings and long afternoon naps." delay={GAP * 2} />
      <WaveText as="p" variant="drift" text="three cats orbit my world." delay={GAP * 3} />
      <WaveText as="p" variant="drift" text="i have a fiancé i love very much." delay={GAP * 4} />

      <WaveText as="p" variant="drift" text="♬(✿˘‿˘✿)♪" delay={GAP * 5} className={styles.spaced} />

      <WaveText as="p" variant="drift" text="i'm happiest when art and code" delay={GAP * 7} />
      <WaveText as="p" variant="drift" text="can't quite tell themselves apart." delay={GAP * 8} />
      <WaveText as="p" variant="drift" text="i've tended projects, from first breath to bloom" delay={GAP * 9} />
      <WaveText as="p" variant="drift" text="solo, among friends, and while leading others." delay={GAP * 10} />
      <WaveText as="p" variant="drift" text="say hello if you'd like to make something together," delay={GAP * 11} />
      <WaveText as="p" variant="drift" text="or if you just want someone" delay={GAP * 12} />
      <WaveText as="p" variant="drift" text="to say hi to!" delay={GAP * 13} />
    </section>
  );
}

export default About;
