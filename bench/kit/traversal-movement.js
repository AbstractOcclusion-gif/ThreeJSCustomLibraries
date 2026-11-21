// Shared by the traversal course and its avatar in mixed demos. Speeds are m/s, gravity is m/s².
export const TRAVERSAL_GRAVITY = 12.8;
export const TRAVERSAL_PLAYER = Object.freeze({radius: .3, height: 1.75, walkSpeed: 1.3, runSpeed: 4.4,
 airControl: 0, jumpSpeed: 5.5, jumpCut: .55, jumpLaunch: 2.4, braking: 16, turnSpeed: 12,
 turnCoupling: .7, turnFirst: .6, standTurnSpeed: 5.5, landingLoss: .7, landingSoft: 4, landingHard: 9});

// A hard landing rolls out only when the requested movement is forward.
const LANDING = {firm: 6.2, hard: 8, forward: .5};
export function recoverTraversalLanding(controller, wish, recovery) {
 const {landed, heading} = controller;
 if (landed < LANDING.firm) return null;
 const forward = wish.x * Math.sin(heading) + wish.z * Math.cos(heading) > LANDING.forward;
 const landing = landed < LANDING.hard ? 'firm' : forward ? 'roll' : 'hard';
 const motion = recovery?.[landing];
 if (motion) controller.commit(motion.seconds, motion.speed);
 return landing;
}
