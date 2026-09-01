import { Utils } from '../Utils';
import { RotationGCD } from './RotationGCD';

class OreRotationController {
    constructor() {
        this.active = false;
        this.targetYaw = 0;
        this.targetPitch = 0;
        this.initialYawDistance = 0;
        this.initialPitchDistance = 0;
        this.speed = 0.12;
        this.gcd = 0;
        this.lastUpdateAt = 0;
        this.yawRemainder = 0;
        this.pitchRemainder = 0;
        this.yawVelocity = 0;
        this.pitchVelocity = 0;
        this.yawArc = 0;
        this.pitchArc = 0;
        this.arcDirection = 1;
        this.trackingVector = null;

        register('postRenderWorld', () => this.update());
    }

    get isRotating() {
        return this.active;
    }

    lookAtVector(vector, speed) {
        const player = Player.getPlayer();
        const angles = player && this.getTargetAngles(player, vector);
        if (!angles || !Number.isFinite(angles.yaw) || !Number.isFinite(angles.pitch) || !Number.isFinite(speed)) return false;
        const currentYaw = player.getYRot();
        const currentPitch = player.getXRot();

        this.targetYaw = RotationGCD.aimModulo360(currentYaw, angles.yaw);
        this.targetPitch = RotationGCD.clampPitch(angles.pitch);
        this.initialYawDistance = Math.abs(RotationGCD.angleDifference(this.targetYaw, currentYaw));
        this.initialPitchDistance = Math.abs(this.targetPitch - currentPitch);

        const distance = Math.hypot(this.initialYawDistance, this.initialPitchDistance);
        const arc = Math.min(0.75, distance * 0.02) * (this.arcDirection *= -1);
        this.yawArc = this.initialYawDistance < 0.5 && this.initialPitchDistance > 1 ? arc : 0;
        this.pitchArc = this.initialPitchDistance < 0.5 && this.initialYawDistance > 1 ? arc : 0;
        if (this.targetPitch > 80) this.pitchArc = -Math.abs(this.pitchArc);
        if (this.targetPitch < -80) this.pitchArc = Math.abs(this.pitchArc);
        this.speed = speed;
        this.gcd = RotationGCD.calculateGCD();
        this.lastUpdateAt = Date.now();
        this.yawRemainder = 0;
        this.pitchRemainder = 0;
        this.yawVelocity = 0;
        this.pitchVelocity = 0;
        this.trackingVector = null;
        this.active = true;
        return true;
    }

    trackVector(vector, speed) {
        if (!this.active) {
            if (!this.lookAtVector(vector, speed)) return false;
            this.trackingVector = vector;
            return true;
        }

        const player = Player.getPlayer();
        if (!player || !vector || !this.refreshTrackedTarget(player, vector)) return false;
        this.trackingVector = vector;
        if (Number.isFinite(speed)) this.speed = speed;
        return true;
    }

    retargetVector(vector, speed) {
        if (!this.active) return this.lookAtVector(vector, speed);

        const player = Player.getPlayer();
        if (!player || !vector || !this.refreshTrackedTarget(player, vector)) return false;
        this.trackingVector = null;
        if (Number.isFinite(speed)) this.speed = speed;
        return true;
    }

    stop() {
        this.active = false;
    }

    update() {
        if (!this.active) return;

        const player = Player.getPlayer();
        if (!player) return this.stop();
        if (this.trackingVector && !this.refreshTrackedTarget(player, this.trackingVector)) return this.stop();

        const now = Date.now();
        const elapsedMs = this.lastUpdateAt ? Math.max(1, Math.min(100, now - this.lastUpdateAt)) : 1000 / 60;
        this.lastUpdateAt = now;

        const currentYaw = player.getYRot();
        const currentPitch = player.getXRot();
        let deltaYaw = RotationGCD.angleDifference(this.targetYaw, currentYaw);
        let deltaPitch = this.targetPitch - currentPitch;
        const distance = Math.hypot(deltaYaw, deltaPitch);

        if (distance <= 0.5) {
            this.yawVelocity = 0;
            this.pitchVelocity = 0;
            if (this.trackingVector) return;
            this.stop();
            return;
        }

        this.initialYawDistance = Math.max(this.initialYawDistance, Math.abs(deltaYaw));
        this.initialPitchDistance = Math.max(this.initialPitchDistance, Math.abs(deltaPitch));

        const speed = Math.max(0.01, Math.min(0.95, this.speed));
        const frequency = (-Math.log(1 - speed) / 0.05) * 1.5;
        const initialDistance = Math.hypot(this.initialYawDistance, this.initialPitchDistance);
        const progress = initialDistance ? 1 - Math.min(1, Math.hypot(deltaYaw, deltaPitch) / initialDistance) : 1;
        const arc = Math.sin(Math.PI * progress);
        deltaYaw += this.yawArc * arc;
        deltaPitch += this.pitchArc * arc;
        const elapsedSeconds = elapsedMs / 1000;
        const yaw = this.springStep(deltaYaw, this.yawVelocity, elapsedSeconds, frequency);
        const pitch = this.springStep(deltaPitch, this.pitchVelocity, elapsedSeconds, frequency);
        this.yawVelocity = yaw.velocity;
        this.pitchVelocity = pitch.velocity;

        const rawYawStep = yaw.step + this.yawRemainder;
        const rawPitchStep = pitch.step + this.pitchRemainder;
        const yawStep = Math.round(rawYawStep / this.gcd) * this.gcd;
        const pitchStep = Math.round(rawPitchStep / this.gcd) * this.gcd;
        this.yawRemainder = rawYawStep - yawStep;
        this.pitchRemainder = rawPitchStep - pitchStep;

        player.setYRot(currentYaw + yawStep);
        player.setXRot(RotationGCD.clampPitch(currentPitch + pitchStep));
    }

    springStep(delta, velocity, elapsedSeconds, frequency) {
        const decay = Math.exp(-frequency * elapsedSeconds);
        const change = -delta;
        const temp = (velocity + frequency * change) * elapsedSeconds;
        return {
            step: delta + (change + temp) * decay,
            velocity: (velocity - frequency * temp) * decay,
        };
    }

    refreshTrackedTarget(player, vector) {
        const angles = this.getTargetAngles(player, vector);
        if (!angles) return false;

        const currentYaw = player.getYRot();
        this.targetYaw = RotationGCD.aimModulo360(currentYaw, angles.yaw);
        this.targetPitch = RotationGCD.clampPitch(angles.pitch);
        return true;
    }

    getTargetAngles(player, vector) {
        const target = Utils.convertToVector(vector);
        if (!target) return false;

        const eyes = player.getEyePosition();
        const dx = target.x() - player.getX();
        const dy = target.y() - eyes.y();
        const dz = target.z() - player.getZ();
        const horizontalDistance = Math.hypot(dx, dz);
        return {
            yaw: horizontalDistance <= 0.0001 ? player.getYRot() : Math.atan2(-dx, dz) * (180 / Math.PI),
            pitch: Math.atan2(-dy, horizontalDistance) * (180 / Math.PI),
        };
    }
}

export const OreRotations = new OreRotationController();
