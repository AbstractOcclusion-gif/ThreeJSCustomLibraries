// The shortest way round from one heading to another: a turn in -PI..PI (rad).
export const shortestTurn = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
