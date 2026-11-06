import type { ReactNode } from 'react'
import { useTheme } from '../themes'
import midnight from '../assets/mascot/midnight.png'
import midnightWrench from '../assets/mascot/midnight-wrench.png'
import midnightClapper from '../assets/mascot/midnight-clapper.png'
import midnightLab from '../assets/mascot/midnight-lab.png'
import midnightEmpty from '../assets/mascot/midnight-empty.png'
import midnightRecap from '../assets/mascot/midnight-recap.png'
import nord from '../assets/mascot/nord.png'
import nordWrench from '../assets/mascot/nord-wrench.png'
import nordClapper from '../assets/mascot/nord-clapper.png'
import nordLab from '../assets/mascot/nord-lab.png'
import nordEmpty from '../assets/mascot/nord-empty.png'
import nordRecap from '../assets/mascot/nord-recap.png'
import forest from '../assets/mascot/forest.png'
import forestWrench from '../assets/mascot/forest-wrench.png'
import forestClapper from '../assets/mascot/forest-clapper.png'
import forestLab from '../assets/mascot/forest-lab.png'
import forestEmpty from '../assets/mascot/forest-empty.png'
import forestRecap from '../assets/mascot/forest-recap.png'
import hypnotic from '../assets/mascot/hypnotic.png'
import hypnoticWrench from '../assets/mascot/hypnotic-wrench.png'
import hypnoticClapper from '../assets/mascot/hypnotic-clapper.png'
import hypnoticLab from '../assets/mascot/hypnotic-lab.png'
import hypnoticEmpty from '../assets/mascot/hypnotic-empty.png'
import hypnoticRecap from '../assets/mascot/hypnotic-recap.png'
import blacked from '../assets/mascot/blacked.png'
import blackedWrench from '../assets/mascot/blacked-wrench.png'
import blackedClapper from '../assets/mascot/blacked-clapper.png'
import blackedLab from '../assets/mascot/blacked-lab.png'
import blackedEmpty from '../assets/mascot/blacked-empty.png'
import blackedRecap from '../assets/mascot/blacked-recap.png'
import sissy from '../assets/mascot/sissy.png'
import sissyWrench from '../assets/mascot/sissy-wrench.png'
import sissyClapper from '../assets/mascot/sissy-clapper.png'
import sissyLab from '../assets/mascot/sissy-lab.png'
import sissyEmpty from '../assets/mascot/sissy-empty.png'
import sissyRecap from '../assets/mascot/sissy-recap.png'

type Pose = 'full' | 'bust' | 'peek' | 'wrench' | 'clapper' | 'lab' | 'empty' | 'recap'

const FULL: Record<string, string> = {
  midnight,
  daylight: nord,
  nord,
  dracula: hypnotic,
  mocha: midnight,
  forest,
  hypnotic,
  blacked,
  sissy
}

const WRENCH: Record<string, string> = {
  midnight: midnightWrench,
  daylight: nordWrench,
  nord: nordWrench,
  dracula: hypnoticWrench,
  mocha: midnightWrench,
  forest: forestWrench,
  hypnotic: hypnoticWrench,
  blacked: blackedWrench,
  sissy: sissyWrench
}

const CLAPPER: Record<string, string> = {
  midnight: midnightClapper,
  daylight: nordClapper,
  nord: nordClapper,
  dracula: hypnoticClapper,
  mocha: midnightClapper,
  forest: forestClapper,
  hypnotic: hypnoticClapper,
  blacked: blackedClapper,
  sissy: sissyClapper
}

const LAB: Record<string, string> = {
  midnight: midnightLab,
  daylight: nordLab,
  nord: nordLab,
  dracula: hypnoticLab,
  mocha: midnightLab,
  forest: forestLab,
  hypnotic: hypnoticLab,
  blacked: blackedLab,
  sissy: sissyLab
}

const EMPTY: Record<string, string> = {
  midnight: midnightEmpty,
  daylight: nordEmpty,
  nord: nordEmpty,
  dracula: hypnoticEmpty,
  mocha: midnightEmpty,
  forest: forestEmpty,
  hypnotic: hypnoticEmpty,
  blacked: blackedEmpty,
  sissy: sissyEmpty
}

const RECAP: Record<string, string> = {
  midnight: midnightRecap,
  daylight: nordRecap,
  nord: nordRecap,
  dracula: hypnoticRecap,
  mocha: midnightRecap,
  forest: forestRecap,
  hypnotic: hypnoticRecap,
  blacked: blackedRecap,
  sissy: sissyRecap
}

function srcFor(pose: Pose, themeId: string): string {
  const pack =
    pose === 'wrench'
      ? WRENCH
      : pose === 'clapper'
        ? CLAPPER
        : pose === 'lab'
          ? LAB
          : pose === 'empty'
            ? EMPTY
            : pose === 'recap'
              ? RECAP
              : FULL
  return pack[themeId] ?? FULL[themeId] ?? midnight
}

export function Mascot({
  pose = 'full',
  className = '',
  themeId
}: {
  pose?: Pose
  className?: string
  themeId?: string
}) {
  const { theme } = useTheme()
  const src = srcFor(pose, themeId ?? theme.id)
  return <img className={`mascot mascot-${pose} ${className}`.trim()} src={src} alt="" draggable={false} />
}

export function LabSetupFrame({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-with-mascot" onClick={(e) => e.stopPropagation()}>
        <Mascot pose="lab" className="modal-mascot" />
        {children}
      </div>
    </div>
  )
}
