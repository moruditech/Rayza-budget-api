const ApiResponse = {
  /**
   * 200 OK with data. `meta` is only included in the envelope when provided,
   * matching the API Contract (e.g. spend log pagination) where most
   * responses omit it entirely.
   */
  success(res, data = null, message = 'Success', meta = undefined) {
    const body = { success: true, data, message };
    if (meta !== undefined) body.meta = meta;
    return res.status(200).json(body);
  },

  /** 201 Created with the newly created resource. */
  created(res, data = null, message = 'Created') {
    return res.status(201).json({ success: true, data, message });
  },

  /**
   * 200 OK with null data — used for actions like logout, password change,
   * or delete where there's nothing to return but the action succeeded.
   */
  noContent(res, message = 'Success') {
    return res.status(200).json({ success: true, data: null, message });
  },
};

module.exports = ApiResponse;
