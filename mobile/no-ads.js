// This release contains no advertising SDK or reward flow.
export const rewardedAds = Object.freeze({
  supported: false, test: false,
  async show() { throw new Error('Esta versión no incluye anuncios.'); },
  async privacy() { throw new Error('Esta versión no incluye anuncios.'); }
});
