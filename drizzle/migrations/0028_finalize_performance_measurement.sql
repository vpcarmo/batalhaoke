-- A single database hook covers every performance status transition, including
-- Livre, X1 and Championship operations that update performances independently.
CREATE OR REPLACE FUNCTION public.finalize_performance_measurement_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('completed', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.finalize_performance_measurement(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER performances_finalize_measurement
AFTER UPDATE OF status ON public.performances
FOR EACH ROW
EXECUTE FUNCTION public.finalize_performance_measurement_on_status_change();
