import { useCallback, useMemo, useState, createRef } from 'react'
import { FieldDef, FieldDefs } from './field-defs'
import { Field, Fields, MutableFields } from './fields'
import { FormOptions } from './form-options'
import { FormTransformers } from './form-transformers'

export {
  Field,
  Fields,
  FieldDef,
  FieldDefs,
  FormOptions,
  FormTransformers
}

type FieldName<T> = Extract<keyof T, string>
type FieldsList<T> = FieldName<T>[] | FieldName<T>

const INITIAL_FORM_OPTIONS: Omit<FormOptions<any, any>, 'fields'> = {
  validateOnBlur: true,
  validateOnChange: false
}

const INITIAL_FIELD_STATE: Pick<Field, 'dirty' | 'touched' | 'error' | 'warn' | 'value'> = {
  dirty: false,
  touched: false,
  error: null,
  warn: null,
  value: undefined,
}

export function useForm<
  T extends { [key: string]: any },
  TValidationResult = any
>(getInitialOptions?: () => FormOptions<T, TValidationResult>) {
  const [, setState] = useState(true)
  const forceUpdate = useCallback(() => setState(s => !s), [])

  const res = useMemo(() => {
    const options = getInitialOptions ? getInitialOptions() : {}
    const _defs = (options.fields || {}) as FieldDefs<T, TValidationResult>
    const _opts: Omit<FormOptions<any, any>, 'fields'> = {
      ...INITIAL_FORM_OPTIONS,
      ...options
    }

    const _fields = {} as MutableFields<T>

    const fieldNames = () => Object.keys(_fields) as FieldName<T>[]

    const transformError = (field: Field, error: any) => {
      const transformers = _opts.transformers

      return error
        ? transformers && transformers.error
          ? transformers.error(error, field)
          : error
        : null
    }

    const validateField = (name: keyof T) => {
      const field = _fields[name]
      const def = _defs[name]
      const validateFn = def.validate
      const warnFn = def.warn

      if (validateFn) {
        field.error = transformError(field, validateFn(field.value))
      }

      if (warnFn) {
        field.warn = transformError(field, warnFn(field.value))
      }

      // Validate dependent fields
      let dependent = def.dependent

      if (dependent) {
        if (typeof dependent === 'string') {
          dependent = [dependent]
        }

        for (const dep of dependent) {
          if (_fields[dep].touched) {
            validateField(dep)
          }
        }
      }
    }

    const handleChange = (name: keyof T, value: any) => {
      const field = _fields[name]

      field.value = value
      field.dirty = true

      const def = _defs[name]

      // Validate
      const validateOnChange = def.validateOnChange != null
        ? def.validateOnChange
        : _opts.validateOnChange

      if (validateOnChange) {
        validateField(name)
      }

      // Handle changed event
      if (def.changed) {
        def.changed(value)
      }

      forceUpdate()
    }

    const handleFocus = (name: keyof T) => {
      const field = _fields[name]

      field.touched = true

      forceUpdate()
    }

    const handleBlur = (name: keyof T) => {
      if (!_fields[name].dirty) {
        return
      }

      const def = _defs[name]

      const validateOnBlur = def.validateOnBlur != null
        ? def.validateOnBlur
        : _opts.validateOnBlur!

      if (validateOnBlur) {
        validateField(name)
      }

      forceUpdate()
    }

    const proxy = new Proxy<Fields<T>>(_fields, {
      get(target, name: Extract<keyof T, string>) {
        if (!target[name]) {
          target[name] = {
            ref: createRef(),
            name,
            label: undefined,

            ...INITIAL_FIELD_STATE,

            onChange: value => handleChange(name, value),
            onFocus: () => handleFocus(name),
            onBlur: () => handleBlur(name)
          }

          if (!_defs[name]) {
            _defs[name] = _opts.fieldConfig && _opts.fieldConfig(name) || {}
          }
        }

        return target[name]
      }
    })

    /**
     * Gets a value that indicates whether the form has error
     */
    const hasError = (fields: FieldsList<T> = fieldNames()) => {
      if (typeof fields === 'string') {
        fields = [fields]
      }

      for (const name of fields) {
        if (_fields[name].error) {
          return true
        }
      }

      return false
    }

    /**
     * Gets a value that indicates whether the form has error
     */
    const hasWarn = (fields: FieldsList<T> = fieldNames()) => {
      if (typeof fields === 'string') {
        fields = [fields]
      }

      for (const name of fields) {
        if (_fields[name].warn) {
          return true
        }
      }

      return false
    }

    const focusInvalidField = () => {
      for (const name of fieldNames()) {
        const field = _fields[name]

        if (field.error) {
          if (field.ref.current) {
            field.ref.current.focus()
          }

          return
        }
      }
    }

    /**
     * Validates specific field(s)
     * @returns `true` when form validates successfully
     */
    const validate = async (fields: FieldsList<T> = fieldNames()) => {
      if (typeof fields === 'string') {
        fields = [fields]
      }

      for (const field of fields) {
        validateField(field)
      }

      const err = hasError(fields)

      if (err) {
        focusInvalidField()
      }

      forceUpdate()

      return !err
    }

    /**
     * Gets a value that indicates whether some field is touched
     */
    const touched = () => {
      for (const name of fieldNames()) {
        if (_fields[name].touched) {
          return true
        }
      }

      return false
    }

    /**
     * Gets a value that indicates whether some field is dirty
     */
    const dirty = () => {
      for (const name of fieldNames()) {
        if (_fields[name].dirty) {
          return true
        }
      }

      return false
    }

    /**
     * Gets form values
     */
    const getValues = () => {
      const data: Partial<T> = {}

      fieldNames().forEach(name => {
        data[name] = _fields[name].value
      })

      return data as T
    }

    /**
     * Sets form values
     */
    const setValues = (values: Partial<T>) => {
      for (const name of Object.keys(values)) {
        _fields[name].value = values[name]
      }

      forceUpdate()
    }

    /**
     * Handles form submit. Typically should be passed into `<form>`
     */
    const handleSubmit = (e: React.SyntheticEvent) => {
      e.preventDefault()

      validate()
        .then(success => {
          if (success && _opts.submit) {
            _opts.submit(getValues())
          }
        })
    }

    /**
     * Resets fields to their initial state
     */
    const reset = (fields: FieldsList<T> = fieldNames()) => {
      for (const name of fields) {
        _fields[name as FieldName<T>] = {
          ..._fields[name as FieldName<T>],
          ...INITIAL_FIELD_STATE
        }
      }

      forceUpdate()
    }

    /**
     * Adds the dynamic fields.
     */
    const add = (fields: FieldDefs<T, TValidationResult>) => {
      for (const name of Object.keys(fields)) {
        _defs[name as FieldName<T>] = fields[name]
      }

      forceUpdate()
    }

    /**
     * Removes the fields. Useful for dynamic fields
     */
    const remove = (fields: FieldsList<T>) => {
      if (typeof fields === 'string') {
        fields = [fields]
      }

      fields.forEach(name => {
        delete _fields[name]
      })

      forceUpdate()
    }

    return {
      fields: proxy,
      validate,
      handleSubmit,
      hasError,
      hasWarn,
      touched,
      dirty,
      getValues,
      setValues,
      reset,
      remove,
      add
    }
  }, [])

  return res
}
