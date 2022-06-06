export enum Errors {
  //*** Library Specific Errors ***
  // WadRayMath
  MATH_MULTIPLICATION_OVERFLOW = '1',
  MATH_ADDITION_OVERFLOW = '2',
  MATH_DIVISION_BY_ZERO = '3',

  // PoolLogic
  NEGATIVE_TIME_DELTA = '4', // "Negative time delta"

  // PositionManager
  POS_MGMT_ONLY_OWNER = '5', // "Only the owner of the position token can manage it (update rate, withdraw)",
  POS_POSITION_ONLY_IN_BONDS = '6', // "Cannot withdraw a position that's only in bonds";
  POS_ZERO_AMOUNT = '7', // "Cannot deposit zero amount";
  POS_TIMELOCK = '8', // "Cannot withdraw or update rate in the same block as deposit";
  POS_POSITION_DOES_NOT_EXIST = '9', // "Position does not exist";

  // PositionDescriptor
  POD_BAD_INPUT = '10', // "Input pool identifier does not correspond to input pool hash";
}
