// // Вступительный взнос
// // const ENTRANCE_FEE_PERSENT = 0.5
// // Членский взнос
// // const MEMBERSHIP_FEE_PERSENT = 5
// // Ежемесячные взносы
// // const MOUNTHLY_FEE_PERSENT = 0.5
// // Переход на второй этап
// // const BUY_PERSENT = 0.45
// // Инфляция
// // const ANNUAL_INFLATION_PERSENT = 5
// // Учётный пай
// // const INITIAL_MEASURE_UNIT_AMOUTN = 2308.83

// // TODO: зп

const DEFAULT_MOUNT_COUNT = 180;
const DEFAULT_MEMBER_PERCENT = 0.45;
const DEFAULT_INFLATION_PERCENT = 5;
const DEFAULT_ENTRANCE_FEE_PERSENT = 0.5;
const DEFAULT_MEMBER_FEE_PERSENT = 5;
const DEFAULT_MOUNTHLY_FEE_PERSENT = 0.5;
const DEFAULT_UNIT = 2395.5415549460236;

/**
 * @param {Number} percent
 **/
const getRate = (percent) => {
  return percent / 100;
};

/**
 * @param {Number} percent
 * @param {Number} [mounthCount=DEFAULT_MOUNT_COUNT]
 **/
const getFactor = (percent, mounthCount = DEFAULT_MOUNT_COUNT) => {
  return Math.pow(1 + percent / 100, Math.floor(mounthCount / 12));
};

/**
 * @param {Number} amount
 * @param {Number} [mounthCount=DEFAULT_MOUNT_COUNT]
 * @param {Number} [invlationPercent=DEFAULT_INFLATION_PERCENT]
 **/
const calculateTotalAmount = (
  amount,
  mounthCount = DEFAULT_MOUNT_COUNT,
  invlationPercent = DEFAULT_INFLATION_PERCENT,
) => {
  const MOUNT_COUNT = 12;

  const years = Math.floor(mounthCount / MOUNT_COUNT);
  const tail = mounthCount - MOUNT_COUNT * years;

  const rate = getRate(invlationPercent);
  const factor = getFactor(invlationPercent, mounthCount);

  const sumFactors =
    rate === 0
      ? mounthCount
      : MOUNT_COUNT * ((factor - 1) / rate) + tail * factor;

  return (amount / mounthCount) * sumFactors;
};

/**
 * @typedef {Object} Config Настройки кредита
 * @property {Number} [monthCount=DEFAULT_MOUNT_COUNT]
 * @property {Number} [memberPercent=DEFAULT_MEMBER_PERCENT] Членство
 * @property {Number} [inflationPercent=DEFAULT_INFLATION_PERCENT] Инфляция
 * @property {Number} [entranceFeePersent=DEFAULT_ENTRANCE_FEE_PERSENT] Вступительный взнос
 * @property {Number} [memberFeePersent=DEFAULT_MEMBER_FEE_PERSENT] Членский взнос
 * @property {Number} [mounthlyFeePersent=DEFAULT_MOUNTHLY_FEE_PERSENT] Ежемесячные взносы
 * @property {Number} [unit=DEFAULT_UNIT] Ежемесячные взносы
 *
 * @param {Number} amount
 * @param {Number} depositAmount
 * @param {Config} [config]
 **/
const calculate = (
  amount,
  depositAmount,
  {
    monthCount = DEFAULT_MOUNT_COUNT,
    memberPercent = DEFAULT_MEMBER_PERCENT,
    inflationPercent = DEFAULT_INFLATION_PERCENT,
    entranceFeePersent = DEFAULT_ENTRANCE_FEE_PERSENT,
    memberFeePersent = DEFAULT_MEMBER_FEE_PERSENT,
    mounthlyFeePersent = DEFAULT_MOUNTHLY_FEE_PERSENT,
    unit = DEFAULT_UNIT,
  } = {},
) => {
  const table = [];

  const unitAmount = amount / unit;
  const depositUnitAmount = depositAmount / unit;
  const realUnitAmount = unitAmount - depositUnitAmount;
  const payUnitAmount = realUnitAmount / monthCount;

  const entranceFeeRate = getRate(entranceFeePersent);
  const memberFeeRate = getRate(memberFeePersent);
  const mounthlyFeeRate = getRate(mounthlyFeePersent);

  let restUnitAmount = realUnitAmount;
  let paidUnitAmount = 0;

  let shouldEntrance = true;
  let shoutMember = false;
  let didMember = false;

  let overpayment = 0;

  for (let mount = 1; mount < monthCount + 1; mount++) {
    const entranceFeeAmount = shouldEntrance ? unitAmount * entranceFeeRate : 0;
    const memberFeeAmount =
      shoutMember && !didMember ? restUnitAmount * memberFeeRate : 0;
    const mounthlyFeeAmount = shoutMember
      ? restUnitAmount * mounthlyFeeRate
      : 0;

    const currentUnitAmount = payUnitAmount; //+ entranceFeeAmount + memberFeeAmount + mounthlyFeeAmount;

    overpayment =
      overpayment + memberFeeAmount + memberFeeAmount + mounthlyFeeAmount;

    table.push({
      mount,
      currentUnitAmount,
      entranceFeeAmount,
      memberFeeAmount,
      mounthlyFeeAmount,
      realUnitAmount,
      restUnitAmount,
      paidUnitAmount,
    });

    restUnitAmount = restUnitAmount - payUnitAmount;
    paidUnitAmount = paidUnitAmount + currentUnitAmount;

    shouldEntrance = false;
    didMember = shoutMember;
    shoutMember = paidUnitAmount > unitAmount * memberPercent;
  }

  console.log(111, overpayment);

  // return table;
};

console.log(
  calculate(140000, 45000, {
    monthCount: 54,
    memberPercent: 0.25,
  }),
);
