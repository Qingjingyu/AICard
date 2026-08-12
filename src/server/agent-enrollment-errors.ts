export class AgentEnrollmentStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentEnrollmentStateError';
  }
}

export class AgentEnrollmentVerificationError extends Error {
  constructor(message = 'Agent signature verification failed') {
    super(message);
    this.name = 'AgentEnrollmentVerificationError';
  }
}
