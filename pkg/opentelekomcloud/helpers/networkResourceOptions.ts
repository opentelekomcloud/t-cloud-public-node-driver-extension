interface SelectOption {
  label: string;
  value: unknown;
}

interface OptionsList {
  options:  SelectOption[];
  selected: unknown;
  busy:     boolean;
  enabled:  boolean;
}

function addCreateNewOption(list: OptionsList, label: string, sentinel: string): void {
  const hasIt = list.options.some((o) => o.value === sentinel);

  if (!hasIt) {
    list.options.unshift({
      label: `── Create new ${ label } ──`,
      value: sentinel,
    });
  }
}

function cancelCreate(list: OptionsList, sentinel: string): void {
  const realOption = list.options.find((o) => o.value !== sentinel);

  list.selected = realOption ? realOption.value : null;
}

function selectByName(list: OptionsList, name: string): void {
  const found = list.options.find((o) => (o.value as Record<string, unknown>)?.name === name);

  if (found) {
    list.selected = found.value;
  }
}

const CIDR_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

function isValidCidr(cidr: string): boolean {
  return CIDR_REGEX.test(cidr);
}

function gatewayFromCidr(cidr: string): string {
  const match = CIDR_REGEX.exec(cidr);

  if (!match) {
    throw new Error(`Invalid CIDR format: ${ cidr }`);
  }

  const octets = [match[1], match[2], match[3], '1'];

  return octets.join('.');
}

const CREATE_NEW_NETWORK = {
  VPC:    '__create_new_vpc__',
  SUBNET: '__create_new_subnet__',
} as const;

export {
  CREATE_NEW_NETWORK,
  addCreateNewOption,
  cancelCreate,
  selectByName,
  isValidCidr,
  gatewayFromCidr,
};

export type { OptionsList };
