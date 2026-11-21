import {Vector3} from 'three';

const CONTACT = {down: .055, release: .095, stepSpeed: .12};

export function createFootContacts(field) {
 const points = [new Vector3(), new Vector3()], planted = [false, false];
 let ready = false, airborne = false;
 return {
  reset() { ready = airborne = false; planted.fill(false); },
  update(avatar, controller, onPlant) {
   if (!avatar || avatar.sampleFeet(points) === false) return;
   const {grounded, heading, speed} = controller;
   const landing = grounded && airborne;
   for (const [side, point] of points.entries()) {
    const gap = point.y - field.heightAt(point.x, point.z);
    const threshold = planted[side] ? CONTACT.release : CONTACT.down;
    const touching = grounded && Number.isFinite(gap) && (point.planted ?? gap <= threshold);
    if (ready && touching && !planted[side] && (landing || speed >= CONTACT.stepSpeed)) onPlant(point, heading);
    planted[side] = touching;
   }
   ready = true;
   airborne = !grounded;
  },
 };
}
