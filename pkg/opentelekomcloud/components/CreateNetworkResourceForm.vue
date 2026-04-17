<script>
import { Banner } from '@components/Banner';
import { LabeledInput } from '@components/Form/LabeledInput';
import { isValidCidr } from '../helpers/networkResourceOptions';

export default {
  components: { Banner, LabeledInput },

  props: {
    resourceLabel: {
      type:     String,
      required: true,
    },
    defaultCidr: {
      type:    String,
      default: '192.168.0.0/16',
    },
    busy: {
      type:    Boolean,
      default: false,
    },
    error: {
      type:    String,
      default: null,
    },
  },

  data() {
    return {
      name: '',
      cidr: this.defaultCidr,
    };
  },

  computed: {
    cidrValid() {
      return !this.cidr || isValidCidr(this.cidr);
    },

    canSubmit() {
      return this.name && this.cidr && this.cidrValid && !this.busy;
    },
  },

  methods: {
    handleSubmit() {
      if (!this.canSubmit) {
        return;
      }

      this.$emit('submit', { name: this.name, cidr: this.cidr });
    },

    handleCancel() {
      this.name = '';
      this.cidr = this.defaultCidr;
      this.$emit('cancel');
    },
  },
};
</script>

<template>
  <div class="row mt-10">
    <div class="col span-4">
      <LabeledInput
        v-model:value="name"
        :label="`${resourceLabel} Name`"
        :required="true"
        :disabled="busy"
      />
    </div>
    <div class="col span-4">
      <LabeledInput
        v-model:value="cidr"
        :label="`${resourceLabel} CIDR`"
        :placeholder="defaultCidr"
        :required="true"
        :disabled="busy"
        :status="cidrValid ? null : 'error'"
        :tooltip="cidrValid ? null : 'Expected format: x.x.x.x/xx'"
      />
    </div>
    <div class="col span-4 create-resource-actions">
      <button
        class="btn role-primary btn-sm"
        :disabled="!canSubmit"
        @click="handleSubmit"
      >
        <i
          v-if="busy"
          class="icon-spinner icon-spin"
        />
        Create
      </button>
      <button
        class="btn role-link btn-sm"
        :disabled="busy"
        @click="handleCancel"
      >
        Cancel
      </button>
    </div>
    <div
      v-if="error"
      class="col span-12 mt-5"
    >
      <Banner
        color="error"
        :label="error"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.create-resource-actions {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding-bottom: 2px;
}
</style>
