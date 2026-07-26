import { ClientboundLevelParticlesPacket } from '../../../utils/Packets';
import Pathfinder from '../../../utils/pathfinder/PathFinder';
import { Rotations } from '../../../utils/player/Rotations';
import { TabListUtils } from '../../../utils/TabListUtils';
import { getLoadedPests } from '../../visuals/PestESP';
import { farmingSettings } from '../FarmingSettings';
import { Utils } from '../../../utils/Utils';

const ANGRY_VILLAGER = net.minecraft.core.particles.ParticleTypes.ANGRY_VILLAGER;
const PEST_RANGE_SQ = 10 ** 2;
const PARTICLE_SEARCH_MS = 2_000;
const PLOT_TIMEOUT_MS = 30_000;
const STATES = {
    SEARCHING: 'Searching',
    PATHING_PESTS: 'Pathing to pests',
    KILLING: 'Killing pest',
    WAITING_FOR_PLOT: 'Waiting for plot',
    CAPTURING_PARTICLES: 'Capturing particles',
    PATHING_PARTICLES: 'Pathing to particles',
    PATHING_FORWARD: 'Pathing forward',
};

class PestKiller {
    constructor() {
        register('packetReceived', (packet) => this.onParticle(packet)).setFilteredClass(ClientboundLevelParticlesPacket);
        register('chat', (event) => this.onChat(event));
    }

    start() {
        this.running = true;
        this.state = STATES.SEARCHING;
        this.currentPlot = null;
        this.teleportedToPlot = false;
        this.visitedPlots = new Set();
        this.pathToken = 0;
        this.targetId = null;
        this.trackedTargetId = null;
        farmingSettings.originalSlot = Player.getHeldItemIndex();
    }

    tick() {
        if (!this.running) return true;
        const { gardenPests, currentPlot, currentPlotPests } = Utils.getGardenPestStatus();
        if (gardenPests === 0 || !gardenPests) {
            this.stop();
            return true;
        }

        const pestsRemainInCurrentPlot = currentPlot === this.currentPlot ? currentPlotPests : null;
        if (pestsRemainInCurrentPlot === 0) {
            this.completeCurrentPlot();
            return false;
        }
        if (this.state === STATES.WAITING_FOR_PLOT) {
            if (!this.teleportedToPlot) return false;
            this.state = STATES.PATHING_FORWARD;
            return false;
        }
        if (!this.currentPlot) {
            this.findNewPlot();
            return false;
        }
        if (Date.now() >= this.plotTimeoutAt) {
            this.completeCurrentPlot();
            return false;
        }

        const pests = getLoadedPests();
        if (this.state === STATES.KILLING) {
            const target = pests.find((pest) => this.id(pest) === this.targetId);
            if (target && this.distanceSq(target) <= PEST_RANGE_SQ) return this.kill(target);
            this.stopKilling();
        }

        if (!pests.length) {
            if (currentPlotPests > 0) return this.startParticleSearch();
        }

        if (pests.length) {
            this.particleSearchGrace = Date.now() + 1000;
            for (const pest of pests) {
                if (this.distanceSq(pest) <= PEST_RANGE_SQ) return this.kill(pest);
            }
            if (this.state !== STATES.PATHING_PESTS || this.hasPestMoved(pests)) this.pathToPests(pests);
            return false;
        }

        switch (this.state) {
            case STATES.PATHING_FORWARD:
                if (!Pathfinder.isPathing()) this.pathToForward();
                return false;
            case STATES.PATHING_PESTS:
                this.stopPath();
                return this.startParticleSearch();
            case STATES.PATHING_PARTICLES:
                return false;
            case STATES.CAPTURING_PARTICLES:
                if (Date.now() >= this.particleSearchEndsAt) this.finishParticleCapture();
                return false;
        }

        return false;
    }

    findNewPlot() {
        const plot = TabListUtils.readPests().infestedPlots.find((candidate) => !this.visitedPlots.has(candidate));
        if (!plot) return;
        this.currentPlot = plot;
        this.teleportedToPlot = false;
        this.visitedPlots.add(plot);
        ChatLib.command(`tptoplot ${plot}`);
        this.plotTimeoutAt = Date.now() + PLOT_TIMEOUT_MS;
        this.state = STATES.WAITING_FOR_PLOT;
    }

    pathToPests(pests) {
        this.stopKilling();
        this.state = STATES.PATHING_PESTS;
        this.pathPestPositions = new Map();
        const goals = [];
        pests.forEach((pest) => {
            this.pathPestPositions.set(this.id(pest), { x: pest.getX(), y: pest.getY(), z: pest.getZ() });
            goals.push(...this.verticalGoals(pest.getX(), pest.getZ()));
        });
        this.startPath(goals, (success) => {
            this.state = STATES.SEARCHING;
        });
    }

    onChat(event) {
        if (!this.running || this.currentPlot === null) return;
        const message = event.message?.getUnformattedText?.() || '';
        if (!message.includes('Teleported you to Plot')) return;

        this.teleportedToPlot = true;
    }

    pathToForward() {
        const yaw = (Number(Player.getYaw()) * Math.PI) / 180;
        const x = Player.getX() - Math.sin(yaw) * 64;
        const z = Player.getZ() + Math.cos(yaw) * 64;
        this.state = STATES.PATHING_FORWARD;
        this.startPath([[Math.floor(x), 80, Math.floor(z)]], (success) => {
            this.state = STATES.SEARCHING;
        });
    }

    hasPestMoved(pests) {
        return pests.some((pest) => {
            const start = this.pathPestPositions?.get(this.id(pest));
            if (!start) return true;
            const dx = pest.getX() - start.x;
            const dy = pest.getY() - start.y;
            const dz = pest.getZ() - start.z;
            return dx * dx + dy * dy + dz * dz > 4 ** 2;
        });
    }

    kill(pest) {
        this.stopPath();
        this.state = STATES.KILLING;
        this.targetId = this.id(pest);
        Client.unpressKeys();
        if (!farmingSettings.selectVacuum()) return false;
        if (this.trackedTargetId !== this.targetId) {
            Rotations.lookAtVector(pest, { precision: 15 });
            this.trackedTargetId = this.targetId;
        }
        Client.setKey('rightclick', true);
        return false;
    }

    stopKilling() {
        if (this.state !== STATES.KILLING) return;
        Rotations.stop();
        Client.unpressKeys();
        this.targetId = null;
        this.trackedTargetId = null;
        this.state = STATES.SEARCHING;
    }

    finishArea() {
        this.currentPlot = null;
        this.teleportedToPlot = false;
        this.state = STATES.SEARCHING;
    }

    completeCurrentPlot() {
        this.stopPath();
        this.stopKilling();
        this.finishArea();
    }

    startParticleSearch() {
        if (this.particleSearchGrace >= Date.now()) return false;
        if (!farmingSettings.selectVacuum()) return false;
        this.firstParticle = null;
        this.lastParticle = null;
        this.state = STATES.CAPTURING_PARTICLES;
        this.particleSearchGrace = Date.now() + 3000;
        this.particleSearchEndsAt = Date.now() + PARTICLE_SEARCH_MS;
        Client.leftClick();
        return false;
    }

    onParticle(packet) {
        if (!this.running || this.state !== STATES.CAPTURING_PARTICLES) return;
        const particle = packet.getParticle?.();
        if ((particle?.getType?.() ?? particle) !== ANGRY_VILLAGER) return;

        const position = { x: packet.getX(), y: packet.getY(), z: packet.getZ() };
        if (!this.firstParticle) this.firstParticle = position;
        else this.lastParticle = position;
    }

    finishParticleCapture() {
        if (!this.lastParticle) return this.completeCurrentPlot();

        const dx = this.lastParticle.x - this.firstParticle.x;
        const dy = this.lastParticle.y - this.firstParticle.y;
        const dz = this.lastParticle.z - this.firstParticle.z;
        const length = Math.hypot(dx, dy, dz);
        if (!length) return this.completeCurrentPlot();

        const x = this.lastParticle.x + (dx / length) * 15;
        const z = this.lastParticle.z + (dz / length) * 15;
        this.state = STATES.PATHING_PARTICLES;
        this.startPath(this.verticalGoals(x, z), (success) => {
            this.state = STATES.SEARCHING;
            if (!success) this.completeCurrentPlot();
        });
    }

    startPath(goals, onComplete) {
        const token = ++this.pathToken;
        Pathfinder.resetPath();
        if (!goals.length) return onComplete(false);
        Pathfinder.findPath(
            goals,
            (success) => {
                if (this.running && token === this.pathToken) onComplete(success);
            },
            true
        );
    }

    stopPath() {
        this.pathToken++;
        if (Pathfinder.isPathing()) Pathfinder.resetPath();
    }

    verticalGoals(x, z) {
        const goals = [];
        for (let y = 66; y < 78; y++) goals.push([Math.floor(x), y, Math.floor(z)]);
        return goals;
    }

    distanceSq(entity) {
        const dx = entity.getX() - Player.getX();
        const dy = entity.getY() - Player.getY();
        const dz = entity.getZ() - Player.getZ();
        return dx * dx + dy * dy + dz * dz;
    }

    id(entity) {
        return entity.getUUID().toString();
    }

    stop() {
        if (!this.running) return;
        this.running = false;
        this.stopPath();
        Rotations.stop();
        Client.unpressKeys();
        farmingSettings.restoreSlot();
    }
}

export const pestKiller = new PestKiller();
